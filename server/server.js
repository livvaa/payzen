const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sunucu ayarları
const PORT = process.env.PORT || 3101;
const app = express();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// CORS ayarları
app.use(cors());
app.use(express.json());

// Dosya depolama alanı
const STORAGE_PATH = path.join(__dirname, 'storage');
const SESSION_PATH = path.join(__dirname, 'sessions');

// Klasörlerin varlığını kontrol et ve oluştur
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

if (!fs.existsSync(SESSION_PATH)) {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

// Aktif oturumları tutacak nesne
const activeSessions = {};

// Hız sınırlama parametreleri
const UPLOAD_RATE_LIMIT = 2 * 1024 * 1024; // 2MB/saniye
const DOWNLOAD_RATE_LIMIT = 2 * 1024 * 1024; // 2MB/saniye

// Kullanıcı başına hız izleme nesneleri
const uploadRateTracker = {};
const downloadRateTracker = {};

// Hız izleme fonksiyonu - daha güçlü token bucket algoritması kullanarak
function trackTransferRate(peerId, bytes, isUpload) {
  const tracker = isUpload ? uploadRateTracker : downloadRateTracker;
  const limit = isUpload ? UPLOAD_RATE_LIMIT : DOWNLOAD_RATE_LIMIT;
  
  if (!tracker[peerId]) {
    tracker[peerId] = {
      bytesTransferred: 0,
      lastResetTime: Date.now(),
      waitingPromises: [],
      transferLog: [] // Son 5 saniyedeki transfer logu
    };
  }
  
  const userTracker = tracker[peerId];
  const currentTime = Date.now();
  
  // Son 5 saniyeye ait logları tut
  userTracker.transferLog.push({
    time: currentTime,
    bytes: bytes
  });
  
  // 5 saniyeden eski logları temizle
  userTracker.transferLog = userTracker.transferLog.filter(log => 
    (currentTime - log.time) < 5000
  );
  
  // Son 1 saniyedeki toplam transfer hesabı
  const lastSecondTransfers = userTracker.transferLog.filter(log => 
    (currentTime - log.time) < 1000
  );
  
  // Son 1 saniyede transfer edilen toplam bayt sayısı
  const lastSecondBytes = lastSecondTransfers.reduce((total, log) => total + log.bytes, 0);
  
  // Anlık hızı hesapla (son 1 saniyede)
  const currentRate = lastSecondBytes; // 1 saniyedeki bayt sayısı = B/s
  
  console.log(`[Hız] Peer: ${peerId}, İşlem: ${isUpload ? 'Yükleme' : 'İndirme'}, Anlık hız: ${Math.round(currentRate/1024/1024*100)/100}MB/s, Limit: ${Math.round(limit/1024/1024*100)/100}MB/s`);
  
  // Limit aşıldı mı kontrol et
  if (currentRate >= limit) {
    const exceededBytes = currentRate - limit;
    
    // Hız limiti aşma oranına göre bekleme süresi belirle (aşma ne kadar büyükse o kadar uzun bekle)
    // Maximum bekleme süresi 1000ms (1 saniye) olacak şekilde sınırla
    const waitTime = Math.min(Math.ceil((exceededBytes / limit) * 1000), 1000);
    
    if (waitTime > 0) {
      console.log(`[UYARI] Hız sınırı aşıldı. Peer: ${peerId}, İşlem: ${isUpload ? 'Yükleme' : 'İndirme'}, Aşım: ${Math.round(exceededBytes/1024/1024*100)/100}MB/s, Bekleme: ${waitTime}ms`);
      
      return new Promise(resolve => {
        userTracker.waitingPromises.push(resolve);
        
        // İlk bekleyen istek ise zamanlayıcı başlat
        if (userTracker.waitingPromises.length === 1) {
          setTimeout(() => {
            // Bekleyen tüm istekleri devam ettir
            const promises = [...userTracker.waitingPromises];
            userTracker.waitingPromises = [];
            promises.forEach(p => p());
          }, waitTime);
        }
      });
    }
  }
  
  return Promise.resolve();
}

// Durum kontrolü
app.get('/relay/status', (req, res) => {
  res.json({ 
    status: 'online',
    timestamp: new Date().toISOString(),
    sessions: Object.keys(activeSessions).length
  });
});

// Oturum başlatma
app.post('/relay/session/start', (req, res) => {
  const { peerId } = req.body;
  
  if (!peerId) {
    return res.status(400).json({ error: 'peerId gerekli' });
  }
  
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const sessionPath = path.join(SESSION_PATH, sessionId);
  
  fs.mkdirSync(sessionPath, { recursive: true });
  
  activeSessions[sessionId] = {
    peerId,
    createdAt: new Date(),
    storageUsed: 0,
    storageLimit: 5 * 1024 * 1024 * 1024, // 5GB
    files: {}
  };
  
  console.log(`Yeni oturum başlatıldı: ${sessionId} (Peer: ${peerId})`);
  
  res.json({ 
    sessionId,
    createdAt: activeSessions[sessionId].createdAt,
    storageUsed: 0,
    storageLimit: activeSessions[sessionId].storageLimit
  });
});

// Oturum silme
app.delete('/relay/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Oturum bulunamadı' });
  }
  
  const sessionPath = path.join(SESSION_PATH, sessionId);
  
  // Oturum klasörünü temizle
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
  
  delete activeSessions[sessionId];
  console.log(`Oturum silindi: ${sessionId}`);
  
  res.json({ success: true });
});

// Dosya kayıt
app.post('/relay/file/register', (req, res) => {
  const { fileId, fileName, fileSize, totalChunks, sessionId } = req.body;
  
  if (!sessionId || !activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!fileId || !fileName || !fileSize || !totalChunks) {
    return res.status(400).json({ error: 'Eksik dosya bilgileri' });
  }
  
  const filePath = path.join(SESSION_PATH, sessionId, fileId);
  fs.mkdirSync(filePath, { recursive: true });
  
  activeSessions[sessionId].files[fileId] = {
    fileName,
    fileSize,
    totalChunks,
    uploadedChunks: [],
    downloadedChunks: {}
  };
  
  console.log(`Dosya kaydedildi: ${fileId} (${fileName}, ${fileSize} bytes, ${totalChunks} parça)`);
  
  res.json({ success: true });
});

// Parça yükleme
app.post('/relay/file/:fileId/chunk/:chunkIndex', upload.single('chunk'), async (req, res) => {
  const { fileId, chunkIndex } = req.params;
  const { sessionId } = req.body;
  const chunkIndex_num = parseInt(chunkIndex);
  
  console.log(`[SUNUCU] Parça yükleme isteği alındı: ${fileId}, Parça: ${chunkIndex}, Oturum: ${sessionId}`);
  
  if (!sessionId || !activeSessions[sessionId]) {
    console.error(`[SUNUCU HATA] Geçersiz oturum: ${sessionId}`);
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!activeSessions[sessionId].files[fileId]) {
    console.error(`[SUNUCU HATA] Dosya bulunamadı: ${fileId}, Oturum: ${sessionId}`);
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  if (!req.file) {
    console.error(`[SUNUCU HATA] Parça verisi eksik: ${fileId}, Parça: ${chunkIndex}`);
    return res.status(400).json({ error: 'Parça verisi eksik' });
  }
  
  // Hız sınırlaması uygula
  const peerId = activeSessions[sessionId].peerId;
  await trackTransferRate(peerId, req.file.size, true);
  
  console.log(`[SUNUCU] Parça alındı: ${fileId}, Parça: ${chunkIndex}, Boyut: ${req.file.size} bytes`);
  
  // Dosya klasörü kontrol edelim ve yoksa oluşturalım
  const fileDirPath = path.join(SESSION_PATH, sessionId, fileId);
  if (!fs.existsSync(fileDirPath)) {
    try {
      fs.mkdirSync(fileDirPath, { recursive: true });
      console.log(`[SUNUCU] Dosya klasörü oluşturuldu: ${fileDirPath}`);
    } catch (dirError) {
      console.error(`[SUNUCU HATA] Dosya klasörü oluşturulamadı: ${fileDirPath}`, dirError);
      return res.status(500).json({
        error: 'Dosya klasörü oluşturulamadı',
        message: dirError.message
      });
    }
  }
  
  const chunkPath = path.join(fileDirPath, `chunk_${chunkIndex}`);
  
  try {
    // Parçayı kaydet
    fs.writeFileSync(chunkPath, req.file.buffer);
    console.log(`[SUNUCU] Parça diskine yazıldı: ${chunkPath}`);
    
    // Kaydetme doğrulaması
    if (!fs.existsSync(chunkPath)) {
      console.error(`[SUNUCU HATA] Parça dosyası kaydedilemedi: ${chunkPath}`);
      throw new Error('Parça dosyası kaydedilemedi');
    }
    
    // Dosya boyutunu kontrol et
    const stats = fs.statSync(chunkPath);
    console.log(`[SUNUCU] Dosya kontrolü: Kaydedilen boyut: ${stats.size}, Beklenen boyut: ${req.file.size}`);
    
    if (stats.size !== req.file.size) {
      console.error(`[SUNUCU HATA] Dosya boyutu uyuşmuyor: ${stats.size} != ${req.file.size}`);
      throw new Error(`Dosya boyutu uyuşmuyor: ${stats.size} != ${req.file.size}`);
    }
    
    // Parça bilgilerini güncelle
    if (!activeSessions[sessionId].files[fileId].uploadedChunks.includes(chunkIndex_num)) {
      activeSessions[sessionId].files[fileId].uploadedChunks.push(chunkIndex_num);
      activeSessions[sessionId].storageUsed += req.file.size;
    }
    
    const fileInfo = activeSessions[sessionId].files[fileId];
    const totalUploadedChunks = fileInfo.uploadedChunks.length;
    const totalChunks = fileInfo.totalChunks;
    
    console.log(`[SUNUCU] Parça yüklendi: ${fileId}, Parça: ${chunkIndex}, Boyut: ${req.file.size} bytes (${totalUploadedChunks}/${totalChunks})`);
    
    // Klasör içeriğini kontrol et ve logla
    const files = fs.readdirSync(fileDirPath);
    console.log(`[SUNUCU] Dosya klasörü içeriği: ${files.join(', ') || 'Boş'}`);
    
    // Durum bilgilerini daha ayrıntılı dön
    res.json({ 
      success: true,
      fileId,
      chunkIndex: chunkIndex_num,
      uploadedChunks: totalUploadedChunks,
      totalChunks: totalChunks,
      progress: Math.floor((totalUploadedChunks / totalChunks) * 100)
    });
  } catch (error) {
    console.error(`[SUNUCU HATA] Parça yükleme hatası: ${fileId}, Parça: ${chunkIndex}`, error);
    res.status(500).json({
      error: 'Parça yüklenirken hata oluştu',
      message: error.message
    });
  }
});

// Parça indirme
app.get('/relay/file/:fileId/chunk/:chunkIndex', async (req, res) => {
  const { fileId, chunkIndex } = req.params;
  const { sessionId, peerId, findAcrossSessions } = req.query;
  const chunkIndex_num = parseInt(chunkIndex);
  
  console.log(`[SUNUCU] Parça indirme isteği alındı: ${fileId}, Parça: ${chunkIndex}, Oturum: ${sessionId}, Peer: ${peerId || 'Bilinmiyor'}`);
  console.log(`[SUNUCU DEBUG] İstek URL: ${req.url}`);
  console.log(`[SUNUCU DEBUG] İstek başlıkları:`, req.headers);
  
  // CORS başlıklarını ayarla - istemci tarafından gelen isteklere izin ver
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.header('Access-Control-Max-Age', '86400'); // 24 saat
  
  // OPTIONS isteği ise başlıkları ayarla ve tamamla
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (!sessionId || !activeSessions[sessionId]) {
    console.error(`[SUNUCU HATA] Geçersiz oturum: ${sessionId}`);
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  console.log(`[SUNUCU DEBUG] Aktif oturum bulundu: ${sessionId}`);
  console.log(`[SUNUCU DEBUG] Aktif dosyalar:`, Object.keys(activeSessions[sessionId].files));
  
  if (!activeSessions[sessionId].files[fileId]) {
    console.error(`[SUNUCU HATA] Dosya bulunamadı: ${fileId}, Oturum: ${sessionId}`);
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  // Bu dosyada parça yüklenmiş mi kontrol et
  const isChunkUploaded = activeSessions[sessionId].files[fileId].uploadedChunks.includes(chunkIndex_num);
  let chunkPath = null;
  
  // Önce varsayılan oturumda parçayı ara
  let potentialChunkPath = path.join(SESSION_PATH, sessionId, fileId, `chunk_${chunkIndex}`);
  if (fs.existsSync(potentialChunkPath)) {
    chunkPath = potentialChunkPath;
    console.log(`[SUNUCU DEBUG] Parça mevcut oturumda bulundu: ${chunkPath}`);
  }
  
  // Eğer parça bulunamazsa ve findAcrossSessions parametresi varsa, diğer oturumlarda da arıyoruz
  if (!chunkPath && findAcrossSessions === 'true') {
    console.log(`[SUNUCU DEBUG] Parça bulunamadı, tüm oturumlar arasında aranıyor: ${fileId}, Parça: ${chunkIndex}`);
    
    // Tüm oturumları dolaşıp aynı fileId ile aynı parçayı arıyoruz
    for (const otherSessionId in activeSessions) {
      if (otherSessionId !== sessionId && // Farklı bir oturum olmalı
          activeSessions[otherSessionId].files[fileId] && // Aynı fileId'ye sahip dosya olmalı
          activeSessions[otherSessionId].files[fileId].uploadedChunks.includes(chunkIndex_num)) { // Parça yüklenmiş olmalı
        
        const otherChunkPath = path.join(SESSION_PATH, otherSessionId, fileId, `chunk_${chunkIndex}`);
        if (fs.existsSync(otherChunkPath)) {
          console.log(`[SUNUCU DEBUG] Parça başka bir oturumda bulundu: ${otherSessionId}, ${fileId}, Parça: ${chunkIndex}`);
          chunkPath = otherChunkPath;
          break;
        }
      }
    }
  }
  
  // Parça bulunamadıysa 404 dön
  if (!chunkPath || !fs.existsSync(chunkPath)) {
    console.log(`[SUNUCU] Parça henüz yüklenmemiş veya bulunamadı: ${fileId}, Parça: ${chunkIndex}`);
    
    return res.status(404).json({ 
      error: 'Parça henüz yüklenmemiş',
      message: 'Parça henüz yüklenici tarafından gönderilmemiş, daha sonra tekrar deneyin',
      waiting: true
    });
  }
  
  console.log(`[SUNUCU] Parça bulundu: ${chunkPath}`);
  
  // İndirme takibi
  if (peerId) {
    if (!activeSessions[sessionId].files[fileId].downloadedChunks[peerId]) {
      activeSessions[sessionId].files[fileId].downloadedChunks[peerId] = [];
    }
    
    if (!activeSessions[sessionId].files[fileId].downloadedChunks[peerId].includes(chunkIndex_num)) {
      activeSessions[sessionId].files[fileId].downloadedChunks[peerId].push(chunkIndex_num);
    }
  }
  
  try {
    // Dosya boyutunu al
    const stats = fs.statSync(chunkPath);
    
    // Hız sınırlaması uygula
    await trackTransferRate(peerId, stats.size, false);
    
    // İndirme işlemi hakkında log
    console.log(`[SUNUCU] Parça indiriliyor: ${fileId}, Parça: ${chunkIndex}, Alıcı: ${peerId || 'Bilinmiyor'}, Boyut: ${stats.size} bytes`);
    
    // Content-Type, Content-Length ve diğer başlıkları ayarla
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="chunk_${chunkIndex}"`);
    res.setHeader('X-Chunk-Index', chunkIndex);
    res.setHeader('X-Total-Chunks', activeSessions[sessionId].files[fileId].totalChunks);
    res.setHeader('X-File-Id', fileId);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    console.log(`[SUNUCU] Parça için response başlıkları ayarlandı: ${fileId}, Parça: ${chunkIndex}, Content-Type: application/octet-stream, Content-Length: ${stats.size}`);
    
    // Dosyayı akış olarak gönder
    const fileStream = fs.createReadStream(chunkPath);
    fileStream.on('error', (error) => {
      console.error(`[SUNUCU HATA] Dosya akışı hatası: ${fileId}, Parça: ${chunkIndex}`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Dosya okuma hatası',
          message: error.message
        });
      } else {
        res.end(); // Headers zaten gönderilmiş, sadece bağlantıyı kapat
      }
    });
    
    fileStream.on('end', () => {
      console.log(`[SUNUCU] Parça tamamen gönderildi: ${fileId}, Parça: ${chunkIndex}`);
    });
    
    fileStream.pipe(res);
  } catch (error) {
    console.error(`[SUNUCU HATA] Parça indirme hatası: ${fileId}, Parça: ${chunkIndex}`, error);
    console.error(`[SUNUCU HATA] Hata detayı:`, error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Parça indirilirken hata oluştu',
        message: error.message,
        stack: error.stack
      });
    } else {
      res.end(); // Headers zaten gönderilmiş, sadece bağlantıyı kapat
    }
  }
});

// Parça silme
app.delete('/relay/file/:fileId/chunk/:chunkIndex', (req, res) => {
  const { fileId, chunkIndex } = req.params;
  const { sessionId } = req.body;
  const chunkIndex_num = parseInt(chunkIndex);
  
  if (!sessionId || !activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!activeSessions[sessionId].files[fileId]) {
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  const chunkPath = path.join(SESSION_PATH, sessionId, fileId, `chunk_${chunkIndex}`);
  
  if (fs.existsSync(chunkPath)) {
    // Dosya boyutunu al
    const stats = fs.statSync(chunkPath);
    const fileSize = stats.size;
    
    // Parçayı sil
    fs.unlinkSync(chunkPath);
    
    // Parçayı uploaded listesinden kaldır
    const index = activeSessions[sessionId].files[fileId].uploadedChunks.indexOf(chunkIndex_num);
    if (index > -1) {
      activeSessions[sessionId].files[fileId].uploadedChunks.splice(index, 1);
      activeSessions[sessionId].storageUsed -= fileSize;
    }
    
    console.log(`Parça silindi: ${fileId}, Parça: ${chunkIndex}`);
    
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Parça bulunamadı' });
  }
});

// Dosya durumu
app.get('/relay/file/:fileId/status', (req, res) => {
  const { fileId } = req.params;
  const { sessionId } = req.query;
  
  if (!sessionId || !activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!activeSessions[sessionId].files[fileId]) {
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  const fileInfo = activeSessions[sessionId].files[fileId];
  
  res.json({
    fileName: fileInfo.fileName,
    fileSize: fileInfo.fileSize,
    totalChunks: fileInfo.totalChunks,
    uploadedChunks: fileInfo.uploadedChunks,
    downloadedChunks: fileInfo.downloadedChunks,
    completed: fileInfo.uploadedChunks.length === fileInfo.totalChunks
  });
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`Relay sunucusu başlatıldı: http://localhost:${PORT}`);
});

module.exports = app; 