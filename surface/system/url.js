export function getToolUrl(relativePath, baseUrl) {
  const url = new URL(relativePath, baseUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.slice(1).map(decodeURIComponent).join('/');
}

export function toToolPath(absoluteUrl) {
  try {
    const url = new URL(absoluteUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.slice(1).map(decodeURIComponent).join('/');
  } catch {
    return absoluteUrl;
  }
}
