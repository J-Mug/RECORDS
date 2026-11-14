import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShopCommentText } from "../components/shop/ShopCommentText";

describe("Shop comments XSS", () => {
  it("escapes HTML and script tags when rendering a public comment", () => {
    const payload = `<script>alert("xss")</script><img src=x onerror="alert(1)">`;
    const html = renderToStaticMarkup(createElement(ShopCommentText, { comment: payload }));
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<img\b/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img/);
    assert.match(html, /class="shop-comment-text"/);
  });
});
