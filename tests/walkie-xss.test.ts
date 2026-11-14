import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WalkieNoteText } from "../components/walkie/WalkieNoteText";

describe("Walkie notes XSS", () => {
  it("escapes HTML and script tags when rendering a note", () => {
    const payload = `<script>alert("xss")</script><img src=x onerror="alert(1)">`;
    const html = renderToStaticMarkup(createElement(WalkieNoteText, { note: payload }));
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<img\b/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img/);
    assert.match(html, /class="walkie-note-text"/);
  });
});
