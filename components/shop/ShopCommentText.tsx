/** Public shop comments are always rendered as text so user HTML/JS cannot execute. */
export function ShopCommentText({ comment }: { comment: string }) {
  return <p className="shop-comment-text">{comment}</p>;
}
