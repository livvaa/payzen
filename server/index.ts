// @ts-nocheck
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Sunucu ayarları
const PORT = process.env.PORT || 3001;
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
const activeSessions: {
  [sessionId: string]: {
    peerId: string;
    createdAt: Date;
    storageUsed: number;
    storageLimit: number;
    files: {
      [fileId: string]: {
        fileName: string;
        fileSize: number;
        totalChunks: number;
        uploadedChunks: number[];
        downloadedChunks: { [peerId: string]: number[] };
      }
    }
  }
} = {};

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
app.post('/relay/file/:fileId/chunk/:chunkIndex', upload.single('chunk'), (req, res) => {
  const { fileId, chunkIndex } = req.params;
  const { sessionId } = req.body;
  const chunkIndex_num = parseInt(chunkIndex);
  
  if (!sessionId || !activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!activeSessions[sessionId].files[fileId]) {
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'Parça verisi eksik' });
  }
  
  const chunkPath = path.join(SESSION_PATH, sessionId, fileId, `chunk_${chunkIndex}`);
  
  // Parçayı kaydet
  fs.writeFileSync(chunkPath, req.file.buffer);
  
  // Parça bilgilerini güncelle
  if (!activeSessions[sessionId].files[fileId].uploadedChunks.includes(chunkIndex_num)) {
    activeSessions[sessionId].files[fileId].uploadedChunks.push(chunkIndex_num);
    activeSessions[sessionId].storageUsed += req.file.size;
  }
  
  console.log(`Parça yüklendi: ${fileId}, Parça: ${chunkIndex}, Boyut: ${req.file.size} bytes`);
  
  res.json({ 
    success: true,
    uploadedChunks: activeSessions[sessionId].files[fileId].uploadedChunks.length,
    totalChunks: activeSessions[sessionId].files[fileId].totalChunks
  });
});

// Parça indirme
app.get('/relay/file/:fileId/chunk/:chunkIndex', (req, res) => {
  const { fileId, chunkIndex } = req.params;
  const { sessionId, peerId } = req.query as { sessionId: string, peerId: string };
  const chunkIndex_num = parseInt(chunkIndex);
  
  if (!sessionId || !activeSessions[sessionId]) {
    return res.status(404).json({ error: 'Geçerli bir oturum bulunamadı' });
  }
  
  if (!activeSessions[sessionId].files[fileId]) {
    return res.status(404).json({ error: 'Dosya bulunamadı' });
  }
  
  const chunkPath = path.join(SESSION_PATH, sessionId, fileId, `chunk_${chunkIndex}`);
  
  if (!fs.existsSync(chunkPath)) {
    return res.status(404).json({ error: 'Parça bulunamadı' });
  }
  
  // İndirme takibi
  if (peerId) {
    if (!activeSessions[sessionId].files[fileId].downloadedChunks[peerId]) {
      activeSessions[sessionId].files[fileId].downloadedChunks[peerId] = [];
    }
    
    if (!activeSessions[sessionId].files[fileId].downloadedChunks[peerId].includes(chunkIndex_num)) {
      activeSessions[sessionId].files[fileId].downloadedChunks[peerId].push(chunkIndex_num);
    }
  }
  
  console.log(`Parça indiriliyor: ${fileId}, Parça: ${chunkIndex}, Alıcı: ${peerId || 'Bilinmiyor'}`);
  
  // Dosyayı gönder
  res.sendFile(chunkPath);
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
  const { sessionId } = req.query as { sessionId: string };
  
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