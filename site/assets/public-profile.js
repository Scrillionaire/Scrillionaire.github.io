const handlePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function publicProfileEndpoint(baseURL, handle) {
  if (!handlePattern.test(handle)) {
    throw new TypeError("Invalid public profile handle");
  }
  return `${baseURL}/${encodeURIComponent(handle)}`;
}

export function formatPublicScore(money) {
  if (!money || !Number.isSafeInteger(money.minorUnits)) {
    return null;
  }
  const currency = typeof money.currency === "string"
    ? money.currency.trim().toUpperCase()
    : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(money.minorUnits / 100);
}

export function isPublicLeaderboardEntry(value) {
  return Boolean(
    value
      && Number.isSafeInteger(value.rank)
      && value.rank > 0
      && typeof value.handle === "string"
      && handlePattern.test(value.handle)
      && typeof value.displayName === "string",
  );
}
