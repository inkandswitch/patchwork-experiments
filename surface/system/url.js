export function getToolUrl(relativePath, baseUrl) {
  const url = new URL(relativePath, baseUrl);
  return url.pathname.replace(/%23[^/]*/, '');
}

export function toToolPath(absoluteUrl) {
  try {
    return new URL(absoluteUrl).pathname.replace(/%23[^/]*/, '');
  } catch {
    return absoluteUrl;
  }
}
