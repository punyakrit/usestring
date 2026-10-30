// Fixture mirrors the real /show/<slug>/ markup recorded in NOTES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offersFromShowPage } from "../src/sources/broadwaydirect.js";

const SHOW_URL = "https://lottery.broadwaydirect.com/show/aladdin/";
const ENTER_URL = "https://lottery.broadwaydirect.com/enter-lottery/?lottery=1096021&window=popup";
const FETCHED = Date.parse("2026-10-30T14:16:00-04:00");
const NOW = Date.parse("2026-10-30T14:30:00-04:00");

const row = (time: string, status: string, link: string) => `
  <tr class="lotteries-row">
    <td class="two columns lotteries-time">${time}&nbsp;</td>
    <td class="four columns lotteries-status">${status}</td>
    <td class="two columns lotteries-center">2&nbsp;</td>
    <td class="one column lotteries-center"><span class="price">$35.00</span>&nbsp;</td>
    <td class="three columns lotteries-right">${link}</td>
  </tr>`;

const page = (rows: string) => `<html><body>
  <div class="venue-information"><p class="show-info-section"><span class="icon"></span></p><h2>New Amsterdam Theatre</h2>214 West 42nd Street<br>New York, NY 10036</div>
  <table class="lottery-table">${rows}</table>
</body></html>`;

const CLOSED = row("10/30/26, 7:00 pm", `<span class="closed hide-for-mobile">Closed</span>`, `<a href="#" class="btn closed-button">Closed</a>`);
const ACTIVE = row("10/31/26, 2:00 pm", `<span class="active">Active</span>/ <span class="hide-for-desktop"></span> Closes Today at 3:00 pm`,
  `<a href="${ENTER_URL.replace(/&/g, "&amp;")}" class="btn btn-default enter-button enter-lottery-link">Enter Now</a>`);
const UPCOMING = row("11/01/26, 1:00 pm", `<span class="pending">Opens </span>10/31/26 at 9:00 am`, `<a href="#" class="btn">Upcoming</a>`);

test("parses active and upcoming rows and skips Closed ones", () => {
  const offers = offersFromShowPage(SHOW_URL, page(CLOSED + ACTIVE + UPCOMING), FETCHED, "ALADDIN (NY)", NOW);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0], {
    source: "broadwaydirect", show: "ALADDIN (NY)", theatre: "New Amsterdam Theatre", type: "lottery", price: 35,
    opensAt: null, closesAt: "2026-10-30T15:00:00-04:00",
    performanceAt: "2026-10-31T14:00:00-04:00", url: ENTER_URL,
  });
  assert.deepEqual(offers[1], {
    source: "broadwaydirect", show: "ALADDIN (NY)", theatre: "New Amsterdam Theatre", type: "lottery", price: 35,
    opensAt: "2026-10-31T09:00:00-04:00", closesAt: null,
    performanceAt: "2026-11-01T13:00:00-05:00", // after the DST change
    url: SHOW_URL, // no entry link yet, so link the show page
  });
});

test('"Closes Today" is the NY date the page was fetched, not the parse date', () => {
  const fetchedYesterday = Date.parse("2026-10-29T10:00:00-04:00");
  const [o] = offersFromShowPage(SHOW_URL, page(ACTIVE), fetchedYesterday, "ALADDIN (NY)", Date.parse("2026-10-29T11:00:00-04:00"));
  assert.equal(o.closesAt, "2026-10-29T15:00:00-04:00");
});

test("drops an active row once its closing time has passed", () => {
  const after = Date.parse("2026-10-30T15:30:00-04:00");
  assert.deepEqual(offersFromShowPage(SHOW_URL, page(ACTIVE), FETCHED, "ALADDIN (NY)", after), []);
});

test("an unrecognised status keeps the row with null bounds instead of crashing", () => {
  const [o] = offersFromShowPage(SHOW_URL, page(row("11/02/26, 7:00 pm", "Sold out", "")), FETCHED, "ALADDIN (NY)", NOW);
  assert.equal(o.opensAt, null);
  assert.equal(o.closesAt, null);
  assert.equal(o.performanceAt, "2026-11-02T19:00:00-05:00");
});

test("a page with no rows or no venue returns [] or a null theatre", () => {
  assert.deepEqual(offersFromShowPage(SHOW_URL, "<html></html>", FETCHED, "X", NOW), []);
  const [o] = offersFromShowPage(SHOW_URL, `<table>${UPCOMING}</table>`, FETCHED, null, NOW);
  assert.equal(o.theatre, null);
  assert.equal(o.show, null);
});
