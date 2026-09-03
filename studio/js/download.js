// Handing a blob to the browser as a file.
//
// Two details matter and are easy to get wrong. The anchor has to be in the
// document for the click to count in every browser, and the object URL must
// outlive the click: revoking it on the next line can cancel the download
// before it has read the blob.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
