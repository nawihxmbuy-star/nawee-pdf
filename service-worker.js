// 🎯 service-worker.js (ฉบับเสถียรที่สุด รองรับการทำงานออฟไลน์ 100%)
const CACHE_NAME = 'nawee-pro-studio-v5'; // 👈 ขยับเป็น v5 เพื่ออัปเดตข้อมูลใหม่

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',

  // 📄 ไลบรารีจัดการไฟล์ PDF และส่งออกข้อมูล (แกะมาจาก index.html และ script.js)
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',

  // 🎨 ไลบรารีไอคอนและฟอนต์ภาษาไทย (ทำให้หน้าตา UI แสดงผลออฟไลน์ได้สวยงาม)
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800&display=swap'
];

// 1. ติดตั้งและบันทึกไฟล์ลงแคชความจำของเครื่อง
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting(); // ทำงานทันทีไม่ต้องรอ
    })
  );
});

// 2. ล้างแคชเวอร์ชันเก่า (v4 ลงไป) ออกจากเครื่องอัตโนมัติ เพื่อประหยัดพื้นที่
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('ระบบกำลังเคลียร์ไฟล์แคชเวอร์ชันเก่าออก:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim(); // เข้าควบคุมหน้าเว็บทั้งหมดทันที
    })
  );
});

// 3. ดักจับการเรียกข้อมูล (เปิดโหมดดึงจากแคชก่อนตอนออฟไลน์)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // ถ้ามีไฟล์ในแคช (ตอนออฟไลน์) ให้ดึงจากแคชมาใช้ได้เลย ทันที 100%
      if (response) {
        return response;
      }
      
      // ถ้าไม่มีในแคช (เช่น การยิง API ไปหา Gemini) ให้วิ่งไปดึงจากเน็ตตามปกติ
      return fetch(event.request).catch(() => {
        // สามารถเขียนตรรกะรองรับกรณี Network ล้มเหลวตรงนี้ได้
      });
    })
  );
});
