self.onmessage = event => {
  if (event.data?.type !== 'decode-camera-raw') {
    self.postMessage({ ok: false, code: 'unsupported_message' });
    return;
  }

  self.postMessage({
    ok: false,
    code: 'raw_decoder_artifacts_missing',
    message: 'Camera RAW import needs the verified offline decoder packet before Studio can open this file.'
  });
};
