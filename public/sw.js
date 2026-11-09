/* Uçuş Logbook - hizmet işçisi
   Yalnızca "uygulama olarak yüklenebilir" olması için vardır. Hiçbir şeyi önbelleğe almaz,
   hiçbir isteği değiştirmez; oturum ve veriler her zamanki gibi doğrudan sunucudan gelir. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* istek olduğu gibi ağa gider */ });
