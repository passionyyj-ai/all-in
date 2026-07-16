if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/all-in/sw.js?v=5.7.3', {scope:'/all-in/'});
    } catch (error) {
      console.error('총무용 PWA 등록 실패', error);
    }
  });
}
