// Inline script to prevent FOUC (Flash of Unstyled Content) on theme load
// This runs before React hydrates, setting the correct class on <html>
export function ThemeScript() {
  const script = `
    (function() {
      try {
        var theme = localStorage.getItem('mc-theme');
        if (theme === 'light') {
          document.documentElement.classList.remove('dark');
        } else {
          document.documentElement.classList.add('dark');
        }
      } catch(e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
