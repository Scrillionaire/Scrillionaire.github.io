const handlePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const opaqueIdentifierPattern = /^[A-Za-z0-9._~-]{1,256}$/;

function decodedSegments(pathname) {
  try {
    return pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return [];
  }
}

export function routeForPath(pathname) {
  const segments = decodedSegments(pathname);

  if (segments.length === 0) {
    return {
      kind: "home",
      eyebrow: "Scrillionaire",
      title: "Scrillionaire",
      summary: "Private finance. Public only when you choose.",
    };
  }

  if (segments.length === 2 && segments[0] === "u" && handlePattern.test(segments[1])) {
    return {
      kind: "profile",
      eyebrow: "Public profile",
      title: `@${segments[1]}`,
      summary: "Loading this member's public leaderboard details.",
      label: "Handle",
      value: `@${segments[1]}`,
      handle: segments[1],
    };
  }

  if (segments.length === 2 && segments[0] === "groups" && segments[1] === "new") {
    return {
      kind: "group-new",
      eyebrow: "Groups",
      title: "Create a group",
      summary: "Group creation is currently available in Scrillionaire for iOS.",
      label: "Action",
      value: "New group",
    };
  }

  if (
    segments.length === 2 &&
    segments[0] === "groups" &&
    opaqueIdentifierPattern.test(segments[1])
  ) {
    return {
      kind: "group",
      eyebrow: "Group",
      title: "Scrillionaire group",
      summary: "This group is currently available in Scrillionaire for iOS.",
      label: "Group",
      value: segments[1],
    };
  }

  if (
    segments.length === 2 &&
    segments[0] === "invite" &&
    opaqueIdentifierPattern.test(segments[1])
  ) {
    return {
      kind: "invite",
      eyebrow: "Invitation",
      title: "Group invitation",
      summary: "This invitation is currently available in Scrillionaire for iOS.",
      label: "Invitation",
      value: "Ready",
    };
  }

  return {
    kind: "not-found",
    eyebrow: "Scrillionaire",
    title: "Page not found",
    summary: "This Scrillionaire link is not valid.",
  };
}
