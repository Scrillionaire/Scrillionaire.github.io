import { routeForPath } from "./routes.js";

const route = routeForPath(window.location.pathname);
const title = document.querySelector("#route-title");
const eyebrow = document.querySelector("#route-eyebrow");
const summary = document.querySelector("#route-summary");
const detail = document.querySelector("#route-detail");
const label = document.querySelector("#route-label");
const value = document.querySelector("#route-value");

eyebrow.textContent = route.eyebrow;
title.textContent = route.title;
summary.textContent = route.summary;
document.title = route.kind === "home" ? "Scrillionaire" : `${route.title} | Scrillionaire`;

if (route.label && route.value) {
  label.textContent = route.label;
  value.textContent = route.value;
  detail.hidden = false;
}
