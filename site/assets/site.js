import { publicProfileAPIBaseURL } from "./config.js";
import {
  formatPublicScore,
  isPublicLeaderboardEntry,
  publicProfileEndpoint,
} from "./public-profile.js";
import { routeForPath } from "./routes.js";

const route = routeForPath(window.location.pathname);
const title = document.querySelector("#route-title");
const eyebrow = document.querySelector("#route-eyebrow");
const summary = document.querySelector("#route-summary");
const detail = document.querySelector("#route-detail");
const label = document.querySelector("#route-label");
const value = document.querySelector("#route-value");
const statusLabel = detail.querySelector("div:nth-child(2) dt");
const statusValue = document.querySelector("#route-status");

eyebrow.textContent = route.eyebrow;
title.textContent = route.title;
summary.textContent = route.summary;
document.title = route.kind === "home" ? "Scrillionaire" : `${route.title} | Scrillionaire`;

if (route.label && route.value) {
  label.textContent = route.label;
  value.textContent = route.value;
  detail.hidden = false;
}

if (route.kind === "profile") {
  loadPublicProfile(route.handle);
}

async function loadPublicProfile(handle) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(publicProfileEndpoint(publicProfileAPIBaseURL, handle), {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 404 ? "not-found" : "unavailable");
    }
    const profile = await response.json();
    renderPublicProfile(profile);
  } catch (error) {
    renderPublicProfileError(error);
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderPublicProfile(profile) {
  if (
    !profile
    || typeof profile.handle !== "string"
    || typeof profile.displayName !== "string"
    || !Array.isArray(profile.top)
  ) {
    renderPublicProfileError(new Error("invalid-response"));
    return;
  }

  const score = formatPublicScore(profile.bigNumber);
  const rank = Number.isSafeInteger(profile.publicRank) && profile.publicRank > 0
    ? `#${profile.publicRank}`
    : null;

  eyebrow.textContent = "Public profile";
  title.textContent = profile.displayName || `@${profile.handle}`;
  summary.textContent = `@${profile.handle}`;
  document.title = `${profile.displayName || `@${profile.handle}`} | Scrillionaire`;
  label.textContent = "Public rank";
  value.textContent = rank ?? "Hidden";
  statusLabel.textContent = "Score";
  statusValue.textContent = score ?? "Hidden";
  detail.hidden = false;

  renderAvatar(profile.avatarUrl, profile.displayName || profile.handle);
  const top = profile.top.filter(isPublicLeaderboardEntry).slice(0, 7);
  const nearby = [profile.above, profile.below].filter(isPublicLeaderboardEntry);
  renderLeaderboard(top, nearby);
}

function renderAvatar(source, name) {
  if (typeof source !== "string" || !source.startsWith("https://storage.googleapis.com/")) {
    return;
  }
  const avatar = document.createElement("img");
  avatar.className = "route-avatar";
  avatar.src = source;
  avatar.alt = `${name} profile picture`;
  avatar.width = 88;
  avatar.height = 88;
  avatar.referrerPolicy = "no-referrer";
  title.before(avatar);
}

function renderLeaderboard(top, nearby) {
  const band = document.createElement("section");
  band.className = "leaderboard-band";
  band.setAttribute("aria-label", "Public leaderboard");

  const content = document.createElement("div");
  content.className = "leaderboard-content";
  content.append(makeLeaderboardGroup("Top 7", top));
  if (nearby.length > 0) {
    content.append(makeLeaderboardGroup("Nearby", nearby));
  }
  band.append(content);

  const principles = document.querySelector(".principles");
  principles.hidden = true;
  principles.before(band);
}

function makeLeaderboardGroup(heading, entries) {
  const group = document.createElement("section");
  group.className = "leaderboard-group";
  const title = document.createElement("h2");
  title.textContent = heading;
  group.append(title);

  const list = document.createElement("ol");
  list.className = "leaderboard-list";
  for (const entry of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/u/${encodeURIComponent(entry.handle)}`;

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `#${entry.rank}`;
    const identity = document.createElement("span");
    identity.className = "leaderboard-identity";
    const name = document.createElement("strong");
    name.textContent = entry.displayName || `@${entry.handle}`;
    const handle = document.createElement("small");
    handle.textContent = `@${entry.handle}`;
    identity.append(name, handle);
    link.append(rank, identity);
    item.append(link);
    list.append(item);
  }
  group.append(list);
  return group;
}

function renderPublicProfileError(error) {
  const missing = error instanceof Error && error.message === "not-found";
  eyebrow.textContent = "Public profile";
  title.textContent = missing ? "Profile not found" : "Profile unavailable";
  summary.textContent = missing
    ? "This profile is private or no longer exists."
    : "The public leaderboard could not be loaded. Please try again shortly.";
  detail.hidden = true;
}
