// talks 共通ヘッダーのプログレスバー
(() => {
  const bar = document.querySelector(".talkbar-progress");
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + "%";
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();
