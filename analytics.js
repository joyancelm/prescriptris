// Share the existing production analytics setup across the game and help pages.
// Local play and local checks never load the remote analytics script.
if (location.hostname === 'www.prescriptris.com' || location.hostname === 'prescriptris.com') {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-6JM3C1R6B9');
  const analytics = document.createElement('script');
  analytics.async = true;
  analytics.src = 'https://www.googletagmanager.com/gtag/js?id=G-6JM3C1R6B9';
  document.head.append(analytics);
}
