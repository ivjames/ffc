import { test } from "node:test";
import assert from "node:assert/strict";
import { tzFromCoords, isValidTz, friendlyTzLabel } from "./timezone.js";

test("tzFromCoords derives the IANA zone for known venue coordinates", () => {
  assert.equal(tzFromCoords(34.08867, -117.67946), "America/Los_Angeles"); // Upland
  assert.equal(tzFromCoords(47.46562, -122.24302), "America/Los_Angeles"); // Tukwila
});

test("tzFromCoords rejects non-finite lat/lng", () => {
  assert.throws(() => tzFromCoords(NaN, -117), TypeError);
  assert.throws(() => tzFromCoords(34, Infinity), TypeError);
  assert.throws(() => tzFromCoords("34", -117), TypeError);
});

test("isValidTz accepts canonical Area/Location names and UTC", () => {
  assert.equal(isValidTz("America/Los_Angeles"), true);
  assert.equal(isValidTz("UTC"), true);
});

test("isValidTz rejects fixed-offset abbreviations and garbage", () => {
  assert.equal(isValidTz("PST"), false); // no "/" and not "UTC" -> rejected up front
  assert.equal(isValidTz("EST5EDT"), false);
  assert.equal(isValidTz("Not/AZone"), false); // has "/" but runtime doesn't recognize it
  assert.equal(isValidTz(""), false);
  assert.equal(isValidTz(null), false);
  assert.equal(isValidTz(123), false);
});

test("friendlyTzLabel renders a generic name + abbreviation", () => {
  assert.equal(friendlyTzLabel("America/Los_Angeles"), "Pacific Time (PT)");
});

test("friendlyTzLabel falls back to the raw string for an invalid zone", () => {
  assert.equal(friendlyTzLabel("PST"), "PST");
  assert.equal(friendlyTzLabel(null), "");
});
