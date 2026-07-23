// ccws — tiny interactions: copy, tabs, scroll-reveal. No dependencies.
(function () {
  "use strict";

  /* ---- copy buttons ------------------------------------------------ */
  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      const label = btn.textContent;
      btn.classList.add("copied");
      btn.textContent = "copied";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.textContent = label;
      }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done));
    } else {
      fallback(text, done);
    }
  }
  function fallback(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (_) { /* noop */ }
    document.body.removeChild(ta);
  }

  document.querySelectorAll(".cmd").forEach((box) => {
    const btn = box.querySelector("[data-copy]");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const code = box.querySelector("code");
      if (code) copyText(code.textContent.trim(), btn);
    });
  });

  /* ---- command tabs ------------------------------------------------ */
  const tabs = document.querySelectorAll(".tab");
  const panes = document.querySelectorAll(".pane");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panes.forEach((p) => p.classList.toggle("active", p.dataset.pane === key));
    });
  });

  /* ---- scroll reveal ----------------------------------------------- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("visible"));
  }
})();
