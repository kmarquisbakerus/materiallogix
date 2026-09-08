#!/usr/bin/env python3
"""Independently decode the browser journey's WAV evidence with FFmpeg.

These files exercise the audio graph. They do not establish that customer
export authorization, billing, physical microphones or listening QA passed.
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys


def inspect(path):
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample,duration',
        '-of', 'json', str(path),
    ]))
    stream = probe['streams'][0]
    expected = {'codec_name': 'pcm_s24le', 'sample_rate': '48000', 'channels': 2, 'bits_per_sample': 24}
    for key, value in expected.items():
        if stream.get(key) != value:
            raise ValueError(f'{path.name}: {key} is {stream.get(key)!r}, expected {value!r}')
    decoded = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
        '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
    ])
    samples = array.array('f', decoded)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples or len(samples) % 2 or any(not math.isfinite(x) for x in samples):
        raise ValueError(f'{path.name}: empty, incomplete or nonfinite audio')
    seconds = len(samples) / 2 / 48000
    if not 8 <= seconds < 10:
        raise ValueError(f'{path.name}: unexpected duration {seconds}')
    channels = []
    for index in range(2):
        channel = samples[index::2]
        rms = math.sqrt(sum(x * x for x in channel) / len(channel))
        peak = max(abs(x) for x in channel)
        clipped = sum(abs(x) >= 0.99999 for x in channel)
        if rms < 0.005 or clipped:
            raise ValueError(f'{path.name}: silent or clipped channel {index + 1}')
        channels.append({'rms': rms, 'sample_peak': peak, 'sample_peak_dbfs': 20 * math.log10(peak),
                         'dc_offset': sum(channel) / len(channel), 'clipped_samples': clipped})
    return samples, {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                     **stream, 'decoded_frames': len(samples) // 2,
                     'decoded_seconds': seconds, 'channel_measurements': channels}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    clean, clean_report = inspect(args.directory / 'music-render-diagnostic.wav')
    marked, marked_report = inspect(args.directory / 'music-free-preview-diagnostic.wav')
    if len(clean) != len(marked):
        raise ValueError('The preview changed the song duration or channel count')
    # Playback scales the arrangement by 0.6 and adds the audible mark. The
    # initial two seconds must contain more than quantization differences.
    frames = min(len(clean), 2 * 48000 * 2)
    difference = math.sqrt(sum((marked[i] - clean[i] * 0.6) ** 2 for i in range(frames)) / frames)
    if difference < 0.001:
        raise ValueError('The decoded preview contains no measurable audio mark')
    result = {'kind': 'engine_diagnostic', 'files': [clean_report, marked_report],
              'preview_mark_difference_rms': difference,
              'limitations': ['Not a customer-authorized export', 'Synthetic microphone input',
                              'Sample peak is not a true-peak or loudness certification',
                              'Listening and physical-device acceptance still required']}
    path = args.directory / 'music-audio-audit.json'
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
