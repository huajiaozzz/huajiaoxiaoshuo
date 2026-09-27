// 花椒写作官网 · 轻交互
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("show");
        io.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
);

document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`;
  io.observe(el);
});

// 导航链接平滑高亮（轻量）
const sections = [...document.querySelectorAll("main section[id]")];
const navLinks = [...document.querySelectorAll(".nav-links a")];

if (sections.length && navLinks.length && "IntersectionObserver" in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.id;
        for (const link of navLinks) {
          link.style.color = link.getAttribute("href") === `#${id}` ? "#c23b22" : "";
        }
      }
    },
    { rootMargin: "-40% 0px -50% 0px", threshold: 0 },
  );
  sections.forEach((s) => spy.observe(s));
}
