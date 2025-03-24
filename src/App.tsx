import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, Col, Input, Menu, MenuProps, message, Row, Space, Typography, Upload, UploadFile, Divider, Layout, Badge, Avatar, Switch, Tooltip, Progress, Statistic, Checkbox } from "antd";
import { CopyOutlined, UploadOutlined, UserOutlined, LinkOutlined, SendOutlined, BulbOutlined, FileOutlined, DisconnectOutlined, ApartmentOutlined, DownloadOutlined, CheckCircleFilled, CloseCircleFilled, InfoCircleOutlined } from "@ant-design/icons";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { startPeer, stopPeerSession } from "./store/peer/peerActions";
import * as connectionAction from "./store/connection/connectionActions";
import { DataType, PeerConnection, Data } from "./helpers/peer";
import { useAsyncState } from "./helpers/hooks";
import { useTheme } from './ThemeContext';
import fileDownload from 'js-file-download';
import { saveAs } from 'file-saver';

const { Title, Text } = Typography;
const { Header, Content, Footer } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

function getItem(
    label: React.ReactNode,
    key: React.Key,
    icon?: React.ReactNode,
    children?: MenuItem[],
    type?: 'group',
): MenuItem {
    return {
        key,
        icon,
        children,
        label,
        type,
    } as MenuItem;
}

// Dosya boyutunu formatlayan fonksiyon
const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
};

// Kalan süreyi formatlayan fonksiyon
const formatTimeRemaining = (speed: number, totalSize: number, progress: number): string => {
    if (speed === 0 || progress >= 100) return '';
    
    // Kalan baytları hesapla
    const remainingBytes = totalSize - (totalSize * progress / 100);
    // Kalan süreyi saniye cinsinden hesapla
    const remainingSeconds = remainingBytes / speed;
    
    // Çok kısa kalan sürelerde veya çok yüksek hızlarda tutarsızlık olmaması için
    if (remainingSeconds < 1) {
        return `1 saniyeden az kaldı`;
    } else if (remainingSeconds < 60) {
        return `${Math.round(remainingSeconds)} saniye kaldı`;
    } else if (remainingSeconds < 3600) {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = Math.round(remainingSeconds % 60);
        return `${minutes} dakika ${seconds} saniye kaldı`;
    } else {
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        return `${hours} saat ${minutes} dakika kaldı`;
    }
};

function FileTransferStatus({
    fileName,
    fileType,
    fileSize,
    progress,
    peerId,
    downloadedSize,
    uploadedSize,
    speed,
    transferType,
    hash,
    hashStatus
}: {
    fileName?: string;
    fileType?: string;
    fileSize?: number;
    progress?: number;
    peerId: string;
    downloadedSize?: number;
    uploadedSize?: number;
    speed?: number;
    transferType: 'download' | 'upload';
    hash?: string;
    hashStatus?: 'match' | 'mismatch' | 'pending';
}) {
    return <div style={{paddingTop: "5px", paddingBottom: "5px"}}>
        <Text>{transferType === 'download' 
            ? `İndirme: ${fileName || 'N/A'} (${peerId})` 
            : `Yükleme: ${fileName || 'N/A'} (Alıcı: ${peerId})`}</Text>
        <div style={{marginTop: "8px"}}>
            <Progress percent={progress || 0} status={progress === 100 ? "success" : "active"}/>
        </div>
        <div style={{ marginTop: "5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
                {transferType === 'download' && downloadedSize !== undefined && 
                    <Text type="secondary" style={{ marginRight: "10px" }}>İndirilen: {formatSize(downloadedSize)} / {formatSize(fileSize || 0)}</Text>
                }
                {transferType === 'upload' && uploadedSize !== undefined && 
                    <Text type="secondary" style={{ marginRight: "10px" }}>Yüklenen: {formatSize(uploadedSize)} / {formatSize(fileSize || 0)}</Text>
                }
                {speed !== undefined && speed > 0 && 
                    <Text type="secondary">{formatSize(speed)}/s</Text>
                }
            </div>
            {/* Hash durumu gösterimi */}
            {progress === 100 && hashStatus && (
                <div style={{ display: "flex", alignItems: "center" }}>
                    {hashStatus === 'match' ? (
                        <Tooltip title="Dosya bütünlüğü doğrulandı">
                            <CheckCircleFilled style={{ color: '#52c41a', fontSize: '20px' }} />
                        </Tooltip>
                    ) : hashStatus === 'mismatch' ? (
                        <Tooltip title="Dosya bütünlüğü doğrulanamadı">
                            <CloseCircleFilled style={{ color: '#f5222d', fontSize: '20px' }} />
                        </Tooltip>
                    ) : (
                        <Text type="secondary">Doğrulanıyor...</Text>
                    )}
                    {hash && (
                        <Tooltip title={`SHA-256: ${hash}`}>
                            <Button type="link" size="small">Hash</Button>
                        </Tooltip>
                    )}
                </div>
            )}
        </div>
    </div>
}

export const App: React.FC = () => {
    const { isDarkMode, toggleTheme } = useTheme();
    const peer = useAppSelector((state) => state.peer);
    const connection = useAppSelector((state) => state.connection);
    const dispatch = useAppDispatch();

    const handleStartSession = () => {
        dispatch(startPeer());
    }

    const handleStopSession = async () => {
        await PeerConnection.closePeerSession();
        dispatch(stopPeerSession());
    }

    const handleConnectOtherPeer = () => {
        connection.id != null ? dispatch(connectionAction.connectPeer(connection.id || "")) : message.warning("Lütfen ID girin");
    }

    const [fileList, setFileList] = useAsyncState([] as UploadFile[]);
    const [sendLoading, setSendLoading] = useAsyncState(false);
    
    // Birden fazla alıcı seçimi için
    const [selectedReceivers, setSelectedReceivers] = useState<string[]>([]);
    const [multiSendMode, setMultiSendMode] = useState<boolean>(false);
    
    // Dokimor sunucusu üzerinden gönderim için
    // NOT: Dokimor sunucuları üzerinden gönder özelliği devre dışı bırakıldı
    const [useServerRelay, setUseServerRelay] = useState<boolean>(false);
    const showServerRelayOption = false; // Sunucu relay UI elementlerini gizlemek için
    
    const [serverRelayStatus, setServerRelayStatus] = useState<{
        connected: boolean;
        storageUsed: number;
        sessionId: string;
    }>({
        connected: false,
        storageUsed: 0,
        sessionId: ''
    });
    
    // Dosya indirme durumu tipi
    interface DownloadStatus {
        fileName: string;
        progress: number;
        fileSize: number;
        complete: boolean;
        transferType?: 'p2p' | 'relay'; // Aktarım tipi
        stopped?: boolean;              // Durduruldu mu
        error?: boolean;                // Hata durumu
    }
    
    // Dosya yükleme durumu tipi
    interface UploadStatus {
        fileName: string;
        progress: number;
        fileSize: number;
        complete: boolean;
        transferType?: 'p2p' | 'relay'; // Aktarım tipi
        stopped?: boolean;              // Durduruldu mu
        error?: boolean;                // Hata durumu
    }
    
    const [downloads, setDownloads] = useState<{
        [fileId: string]: DownloadStatus
    }>({});
    
    const [uploads, setUploads] = useState<{
        [fileId: string]: UploadStatus
    }>({});

    const [uploadSpeed, setUploadSpeed] = useState<{[key: string]: number}>({});
    const [downloadSpeed, setDownloadSpeed] = useState<{[key: string]: number}>({});
    
    // Dosya gönderme durumlarını izlemek için ref'ler
    const uploadLastBytes = useRef<{[key: string]: {bytes: number, time: number, speedHistory: number[]}}>({});
    const downloadLastBytes = useRef<{[key: string]: {bytes: number, time: number, speedHistory: number[]}}>({});
    
    // Bağlantı durumu ve aktif yükleme izleme
    const receiverConnectionStatus = useRef<{[receiverId: string]: boolean}>({});
    const activeUploads = useRef<{[fileId: string]: boolean}>({});
    const shouldStopAllUploads = useRef<boolean>(false);
    
    // Yükleme iptal kontrolü için
    const uploadAbortController = useRef<AbortController | null>(null);
    
    // Yükleme durdurma fonksiyonu
    const stopAllUploads = async () => {
        shouldStopAllUploads.current = true;
        
        // Aktif iptal kontrolcüsü varsa iptal et
        if (uploadAbortController.current) {
            console.log("[UPLOAD MANAGER] İptal sinyali gönderiliyor");
            uploadAbortController.current.abort();
            uploadAbortController.current = null;
        }
        
        // Tüm relay yükleme durumlarını durduruldu olarak işaretle
        setUploads(prev => {
            const newUploads = { ...prev };
            Object.keys(newUploads).forEach(key => {
                if (newUploads[key].transferType === 'relay' && !newUploads[key].complete) {
                    newUploads[key] = {
                        ...newUploads[key],
                        stopped: true,
                        error: true
                    };
                }
            });
            return newUploads;
        });
        
        // Sunucu oturumunu temizle
        try {
            const serverRelay = (await import('./helpers/server-relay')).default;
            await serverRelay.cleanupSession();
            console.log("[UPLOAD MANAGER] Tüm yüklemeler durduruldu, sunucu oturumu temizlendi");
        } catch (err) {
            console.error("[UPLOAD MANAGER] Oturum temizleme hatası:", err);
        }
    };

    const [fileHashes, setFileHashes] = useState<Map<string, string>>(new Map());
    const [hashStatus, setHashStatus] = useState<Map<string, 'match' | 'mismatch' | 'pending'>>(new Map());

    // Hız hesaplayan ve yumuşatan yardımcı fonksiyon
    const calculateSmoothedSpeed = (currentBytes: number, lastRecord: {bytes: number, time: number, speedHistory: number[]}, currentTime: number, isServerRelay: boolean = false): number => {
        const bytesDiff = currentBytes - lastRecord.bytes;
        const timeDiff = (currentTime - lastRecord.time) / 1000;
        
        // Geçersiz değerler için önceki ortalamayı döndür
        if (timeDiff <= 0 || bytesDiff <= 0) {
            return lastRecord.speedHistory.length > 0 
                ? lastRecord.speedHistory.reduce((a, b) => a + b, 0) / lastRecord.speedHistory.length 
                : 0;
        }
        
        // Anlık hızı hesapla (bayt/saniye)
        let instantSpeed = Math.floor(bytesDiff / timeDiff);
        
        // Sunucu üzerinden aktarım için özel hız hesaplaması
        if (isServerRelay) {
            // Sunucu aktarımı 2MB/s ile sınırlı, bu yüzden hesaplanan hız buna yakın olmalı
            const serverSpeedLimit = 2 * 1024 * 1024; // 2MB/s
            
            // Eğer anlık hız, gerçekte mümkün olan maksimum hızdan çok fazlaysa
            // (sunucu limiti veya küçük bağlantı paketleri nedeniyle), bunu düzeltmemiz gerekiyor
            if (instantSpeed > serverSpeedLimit * 1.5) {
                // Gerçek limiti kabaca geçmeyecek bir değere ayarla
                const correction = Math.random() * 0.2 + 0.9; // 0.9-1.1 arası rassal bir çarpan
                instantSpeed = Math.floor(serverSpeedLimit * correction);
                console.log(`[Hız Düzeltme] Sunucu aktarımı hız limiti uygulandı: ${formatSize(instantSpeed)}/s`);
            }
        } else {
            // Geçmiş değerlerle aşırı farklılık kontrolü (normal P2P aktarımı için)
            if (lastRecord.speedHistory.length > 0) {
                const avgSpeed = lastRecord.speedHistory.reduce((a, b) => a + b, 0) / lastRecord.speedHistory.length;
                
                // Ani yüksek hız sıçramalarını sınırla
                if (instantSpeed > avgSpeed * 3 && avgSpeed > 1024 * 100) { // 100 KB/s'den hızlıysa
                    console.log(`Hız normalizasyonu: ${formatSize(instantSpeed)}/s -> ${formatSize(avgSpeed * 1.5)}/s`);
                    instantSpeed = avgSpeed * 1.5; // Makul bir artış sınırı
                }
                
                // Ani düşük hız düşüşlerini yumuşat
                if (instantSpeed < avgSpeed * 0.3 && avgSpeed > 1024 * 100) {
                    console.log(`Düşük hız düzeltmesi: ${formatSize(instantSpeed)}/s -> ${formatSize(avgSpeed * 0.7)}/s`);
                    instantSpeed = avgSpeed * 0.7; // Makul bir düşüş sınırı
                }
            }
        }
        
        // Ağırlıklı hareketli ortalama hesaplama
        // Daha yeni ölçümler daha fazla ağırlığa sahip olacak
        const speedHistory = [...lastRecord.speedHistory];
        speedHistory.push(instantSpeed);
        
        // Geçmişi sınırla (son 5 ölçüm)
        if (speedHistory.length > 5) {
            speedHistory.shift();
        }
        
        // Ağırlıklı ortalama hesaplama - son değerlere daha fazla ağırlık ver
        const weights = [0.1, 0.15, 0.2, 0.25, 0.3]; // Toplam 1.0
        let weightedSum = 0;
        let weightTotal = 0;
        
        for (let i = 0; i < speedHistory.length; i++) {
            const weight = weights[weights.length - speedHistory.length + i] || weights[0];
            weightedSum += speedHistory[i] * weight;
            weightTotal += weight;
        }
        
        // Yumuşatılmış hız
        return Math.floor(weightedSum / weightTotal);
    };

    useEffect(() => {
        // Seçilen ID değiştiğinde data listener'ları temizle ve yeniden kur
        if (connection.selectedId) {
            try {
                try {
                    PeerConnection.clearDataListeners(connection.selectedId);
                } catch (e) {
                    console.log("Dinleyici temizleme hatası:", e);
                }
                
                downloadLastBytes.current = {};
                
                PeerConnection.onConnectionReceiveData(connection.selectedId, async (data) => {
                    // Sunucu üzerinden aktarım bilgisi geldiğinde
                    if (data.dataType === DataType.RELAY_FILE_INFO && data.fileId && data.sessionId) {
                        console.log("Sunucu üzerinden dosya bilgisi alındı:", data);
                        
                        const fileId = data.fileId;
                        const fileName = data.fileName || "bilinmeyen dosya";
                        const fileSize = data.fileSize || 0;
                        const totalChunks = data.totalChunks || 0;
                        const sessionId = data.sessionId;
                        
                        // Kullanıcıya bilgi ver
                        message.info(`"${fileName}" dosyası Dokimor sunucusu üzerinden indirilecek`);
                        
                        // İndirme durumu oluştur
                        setDownloads(prev => ({
                            ...prev,
                            [fileId]: {
                                fileName: fileName,
                                progress: 0,
                                fileSize: fileSize,
                                complete: false,
                                transferType: 'relay'
                            }
                        }));
                        
                        // Hız ölçümü için başlangıç değerlerini ayarla
                        downloadLastBytes.current[fileId] = {
                            bytes: 0,
                            time: Date.now(),
                            speedHistory: []
                        };
                        
                        setDownloadSpeed(prev => ({
                            ...prev,
                            [fileId]: 0
                        }));
                        
                        // Sunucu modülünü yükle ve parçaları indir
                        import('./helpers/server-relay').then(module => {
                            const serverRelay = module.default;
                            const chunkSize = 1024 * 1024; // 1MB
                            const chunks = new Array(totalChunks);
                            let downloadedChunks = 0;
                            
                            const downloadChunks = async () => {
                                try {
                                    console.log(`[Dosya İndirme] Başlıyor: ${fileName}, ToplamParça: ${totalChunks}, ToplamBoyut: ${fileSize} bytes`);
                                    
                                    // Önce oturum durumunu kontrol et
                                    console.log(`[Dosya İndirme] Oturum durumu kontrol ediliyor`);
                                    const sessionInfo = serverRelay.getSessionInfo();
                                    console.log(`[Dosya İndirme] Aktif oturum: ${sessionInfo ? sessionInfo.sessionId : 'YOK'}`);
                                    
                                    if (!sessionInfo) {
                                        console.log(`[Dosya İndirme] Oturum bulunamadı, yeni oturum başlatılıyor`);
                                        await serverRelay.startSession(peer.id || 'unknown');
                                        console.log(`[Dosya İndirme] Yeni oturum başlatıldı: ${serverRelay.getSessionInfo()?.sessionId}`);
                                    }
                                    
                                    // Dosyayı sunucuda kaydet (eğer bulunmuyorsa)
                                    console.log(`[Dosya İndirme] Dosya kaydı senkronize ediliyor: ${fileId}`);
                                    const syncResult = await serverRelay.syncFileStatus(fileId);
                                    console.log(`[Dosya İndirme] Dosya senkronizasyon sonucu: ${syncResult ? 'Başarılı' : 'Başarısız'}`);
                                    
                                    if (!syncResult) {
                                        console.log(`[Dosya İndirme] Dosya sunucuda bulunamadı, kaydediliyor: ${fileId}`);
                                        // Dosya kaydedilemezse register et
                                        const registerResult = await serverRelay.registerFile({
                                            fileId: fileId,
                                            fileName: fileName || 'unknown',
                                            fileSize: fileSize || 0,
                                            totalChunks: totalChunks
                                        });
                                        console.log(`[Dosya İndirme] Dosya kayıt sonucu: ${registerResult ? 'Başarılı' : 'Başarısız'}`);
                                    }
                                    
                                    // Parçaların sunucuda mevcut olup olmadığını kontrol et
                                    const fileStatus = await serverRelay.getFileStatus(fileId);
                                    
                                    // Gönderen taraftan eksik parçaları talep et
                                    if (fileStatus && fileStatus.uploadedChunks.length < totalChunks) {
                                        console.log(`[Dosya İndirme] Eksik parçalar tespit edildi. Sunucuda ${fileStatus.uploadedChunks.length}/${totalChunks} parça mevcut.`);
                                        
                                        // Gönderen tarafa parçaları tekrar yükleme talebi gönder
                                        if (data && 'peerId' in data && data.peerId) {
                                            const senderPeerId = data.peerId;
                                            console.log(`[Dosya İndirme] Gönderen tarafa (${senderPeerId}) parça yükleme talebi gönderiliyor...`);
                                            
                                            // Hangi parçaların eksik olduğunu belirle
                                            const missingChunks = [];
                                            for (let i = 0; i < totalChunks; i++) {
                                                if (!fileStatus.uploadedChunks.includes(i)) {
                                                    missingChunks.push(i);
                                                }
                                            }
                                            
                                            console.log(`[Dosya İndirme] Eksik parçalar: ${missingChunks.join(', ')}`);
                                            
                                            try {
                                                // Gönderene parça yükleme talebi gönderelim
                                                await PeerConnection.sendConnection(senderPeerId, {
                                                    dataType: DataType.RELAY_CHUNK_INFO,
                                                    fileId: fileId,
                                                    message: "MISSING_CHUNKS",
                                                    chunkIndex: -1, // Özel değer, birden fazla parça istediğimizi belirtmek için
                                                    totalChunks: totalChunks,
                                                    sessionId: sessionId || '', // null olma ihtimaline karşı boş string ekleyelim
                                                    // missingChunks dizisini doğrudan gönderemiyoruz, özel bir formatta string'e çevirelim
                                                    fileName: missingChunks.join(',') // missingChunks listesini geçici olarak fileName alanında gönderiyoruz
                                                });
                                                
                                                
                                                message.info(`Eksik dosya parçaları (${missingChunks.length} adet) için gönderen tarafa talep gönderildi.`);
                                            } catch (error) {
                                                console.error(`[Dosya İndirme] Eksik parça talebi gönderirken hata: ${error}`);
                                                message.error(`Gönderene ulaşılamadı, parçalar talep edilemedi!`);
                                            }
                                            
                                            // 10 saniye boyunca tekrar deneme yapalım
                                            for (let retry = 0; retry < 3; retry++) {
                                                console.log(`[Dosya İndirme] Yeniden deneme ${retry+1}/3...`);
                                                
                                                // Parçaları tekrar senkronize et
                                                await serverRelay.syncFileStatus(fileId);
                                                
                                                // Dosya durumunu tekrar kontrol et
                                                const refreshedStatus = await serverRelay.getFileStatus(fileId);
                                                if (refreshedStatus && refreshedStatus.uploadedChunks.length === totalChunks) {
                                                    console.log(`[Dosya İndirme] Tüm parçalar sunucuda mevcut, indirme devam edebilir.`);
                                                    break;
                                                }
                                                
                                                // 3 saniye bekle
                                                await new Promise(resolve => setTimeout(resolve, 3000));
                                            }
                                        } else {
                                            console.log(`[Dosya İndirme] Gönderen tarafın ID'si bilinmiyor, parça talep edilemiyor.`);
                                            message.error(`Dosya parçaları sunucuda bulunamadı ve gönderen bilgisi eksik!`);
                                        }
                                    }
                                    
                                    const downloadPromises = [];
                                    
                                    // İndirme işlemini sırasız yapalım
                                    // Her parça için ayrı bir indirme işi oluşturalım
                                    for (let i = 0; i < totalChunks; i++) {
                                        // Her parça için bir indirme işlemi
                                        const downloadPromise = (async (chunkIndex) => {
                                            console.log(`[Dosya İndirme] Parça ${chunkIndex} indirme işlemi başlatılıyor`);
                                            // Parçaları indirme denemesi - maksimum 3 deneme
                                            for (let attempt = 0; attempt < 3; attempt++) {
                                                try {
                                                    // Sunucudan parçayı indir
                                                    console.log(`[Dosya İndirme] Parça ${chunkIndex} indirme denemesi ${attempt+1}/3`);
                                                    const chunk = await serverRelay.downloadChunk(fileId, chunkIndex, peer.id || '');
                                                    
                                                    if (!chunk) {
                                                        console.error(`[Dosya İndirme HATA] Parça ${chunkIndex} indirilemedi (Deneme ${attempt+1}/3): null yanıt`);
                                                        // Başarısız olursa biraz bekle ve tekrar dene
                                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                                        continue;
                                                    }
                                                    
                                                    // Parça boyutunu kontrol et
                                                    console.log(`[Dosya İndirme] Parça ${chunkIndex} alındı, Boyut: ${chunk.size} bytes`);
                                                    
                                                    // Parçaları doğru sırada tutalım (asenkron indirme için)
                                                    chunks[chunkIndex] = chunk;
                                                    
                                                    // Başarıyla indirilen parça sayısını artır ve ilerlemeyi güncelle
                                                    downloadedChunks++;
                                                    
                                                    // İlerleme durumunu güncelle
                                                    const progress = Math.floor((downloadedChunks / totalChunks) * 100);
                                                    const downloadedBytes = downloadedChunks * chunkSize;
                                                    
                                                    // Hız hesaplaması
                                                    const currentTime = Date.now();
                                                    
                                                    if (downloadLastBytes.current[fileId]) {
                                                        const currentTime = Date.now();
                                                        
                                                        // Yumuşatılmış hız hesaplama fonksiyonunu kullan - sunucu modunda olduğumuz için true
                                                        const smoothedSpeed = calculateSmoothedSpeed(downloadedBytes, downloadLastBytes.current[fileId], currentTime, true);
                                                        
                                                        // Hız değerini güncelle
                                                        setDownloadSpeed(prev => ({
                                                            ...prev,
                                                            [fileId]: smoothedSpeed
                                                        }));
                                                        
                                                        // Son bayt, zaman ve hız geçmişi bilgisini güncelle
                                                        const currentSpeedHistory = downloadLastBytes.current[fileId].speedHistory.length > 0
                                                            ? [...downloadLastBytes.current[fileId].speedHistory]
                                                            : [];
                                                        
                                                        downloadLastBytes.current[fileId] = {
                                                            bytes: downloadedBytes,
                                                            time: currentTime,
                                                            speedHistory: currentSpeedHistory
                                                        };
                                                        
                                                        // Yeni hız ölçümünü ekle
                                                        if (smoothedSpeed > 0) {
                                                            downloadLastBytes.current[fileId].speedHistory.push(smoothedSpeed);
                                                            // En fazla son 5 ölçümü tut
                                                            if (downloadLastBytes.current[fileId].speedHistory.length > 5) {
                                                                downloadLastBytes.current[fileId].speedHistory.shift();
                                                            }
                                                        }
                                                    }
                                                    
                                                    setDownloads(prev => {
                                                        const download = prev[fileId];
                                                        if (download) {
                                                            return {
                                                                ...prev,
                                                                [fileId]: {
                                                                    ...download,
                                                                    progress: progress
                                                                }
                                                            };
                                                        }
                                                        return prev;
                                                    });
                                                    
                                                    // Başarılı olduğumuzda döngüden çık
                                                    return;
                                                } catch (error) {
                                                    console.error(`Parça indirme hatası (Deneme ${attempt+1}/3): ${chunkIndex}`, error);
                                                    
                                                    // Son deneme başarısız olursa hata fırlat
                                                    if (attempt === 2) {
                                                        throw error;
                                                    }
                                                }
                                            }
                                        })(i);
                                        
                                        downloadPromises.push(downloadPromise);
                                    }
                                    
                                    // Tüm indirme işlerinin tamamlanmasını bekle
                                    await Promise.allSettled(downloadPromises);
                                    
                                    // Eksik parça kontrolü
                                    const missingChunks = chunks.findIndex(chunk => !chunk);
                                    if (missingChunks !== -1) {
                                        console.error(`[Dosya İndirme HATA] Eksik parçalar var. İlk eksik parça: ${missingChunks}`);
                                        console.log(`[Dosya İndirme DEBUG] Parça durumları:`, chunks.map((chunk, idx) => ({ 
                                            index: idx, 
                                            exists: !!chunk, 
                                            size: chunk ? chunk.size : 0 
                                        })));
                                        throw new Error(`Bazı parçalar eksik: ${missingChunks}`);
                                    }
                                    
                                    console.log(`[Dosya İndirme] Tüm parçalar başarıyla indirildi. Parçaları birleştirme başlıyor.`);
                                    // Dosyayı birleştir
                                    const completeFile = new Blob(chunks, { type: data.fileType || 'application/octet-stream' });
                                    console.log(`[Dosya İndirme] Dosya birleştirildi. Toplam boyut: ${completeFile.size} bytes`);
                                    
                                    // Dosyayı indir
                                    if (completeFile && fileName) {
                                        try {
                                            const url = URL.createObjectURL(completeFile);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = fileName;
                                            document.body.appendChild(a);
                                            a.click();
                                            
                                            // Temizlik işlemleri için setTimeout kullan
                                            setTimeout(() => {
                                                URL.revokeObjectURL(url);
                                                document.body.removeChild(a);
                                            }, 100);
                                            
                                            message.success(`"${fileName}" dosyası indirildi`);
                                        } catch (error) {
                                            console.error("Dosya indirme hatası:", error);
                                            message.error(`"${fileName}" dosyası indirilirken hata oluştu`);
                                        }
                                    }
                                    
                                    // İndirme durumunu tamamlandı olarak işaretle
                                    setDownloads(prev => {
                                        const download = prev[fileId];
                                        if (download) {
                                            return {
                                                ...prev,
                                                [fileId]: {
                                                    ...download,
                                                    progress: 100,
                                                    complete: true
                                                }
                                            };
                                        }
                                        return prev;
                                    });
                                    
                                    // Hız bilgisini sıfırla
                                    setDownloadSpeed(prev => ({
                                        ...prev,
                                        [fileId]: 0
                                    }));
                                    
                                } catch (error) {
                                    console.error("Sunucu üzerinden indirme hatası:", error);
                                    message.error(`"${fileName}" dosyası sunucudan indirilirken hata oluştu`);
                                    
                                    // Hata durumunda indirme durumunu güncelle
                                    setDownloads(prev => {
                                        const download = prev[fileId];
                                        if (download) {
                                            return {
                                                ...prev,
                                                [fileId]: {
                                                    ...download,
                                                    error: true,
                                                    stopped: true
                                                }
                                            };
                                        }
                                        return prev;
                                    });
                                    
                                    // Sunucu oturumunu temizlemeyi dene
                                    try {
                                        await serverRelay.cleanupSession();
                                        console.log("İndirme hatası sonrası sunucu oturumu temizlendi");
                                    } catch (cleanupError) {
                                        console.error("Oturum temizlenirken hata:", cleanupError);
                                    }
                                }
                            };
                            
                            // İndirme işlemini başlat
                            downloadChunks();
                        }).catch(error => {
                            console.error("Sunucu modülü yükleme hatası:", error);
                            message.error(`Sunucu modülü yüklenirken hata oluştu`);
                        });
                    }
                    // Normal dosya iletimi
                    else if (data.dataType === DataType.FILE && data.fileId) {
                        if (data.message === "START_DOWNLOAD") {
                            console.log("Dosya indirme başladı:", data.fileName, "Boyut:", data.fileSize);
                            
                            downloadLastBytes.current[data.fileId!] = {
                                bytes: 0,
                                time: Date.now(),
                                speedHistory: []
                            };
                            
                            setDownloads(prev => ({
                                ...prev,
                                [data.fileId!]: {
                                    fileName: data.fileName || "bilinmeyen dosya",
                                    progress: 0,
                                    fileSize: data.fileSize || 0,
                                    complete: false,
                                    transferType: 'p2p'
                                }
                            }));
                            
                            setDownloadSpeed(prev => ({
                                ...prev,
                                [data.fileId!]: 0
                            }));
                            
                            // Hash durumunu "beklemede" olarak işaretle
                            const updatedHashStatus = new Map(hashStatus);
                            updatedHashStatus.set(data.fileId || "", 'pending');
                            setHashStatus(updatedHashStatus);
                        }
                        else if (data.message === "PROGRESS") {
                            console.log(`Dosya indirme ilerlemesi: ${data.fileName} - %${data.progress}`);
                            
                            const fileId = data.fileId!;
                            const fileSize = data.fileSize || 0;
                            const progress = data.progress || 0;
                            const currentBytes = Math.floor(progress / 100 * fileSize);
                            const currentTime = Date.now();
                            
                            if (downloadLastBytes.current[fileId]) {
                                const lastRecord = downloadLastBytes.current[fileId];
                                const bytesDiff = currentBytes - lastRecord.bytes;
                                const timeDiff = (currentTime - lastRecord.time) / 1000;
                                
                                if (timeDiff > 0 && bytesDiff > 0) {
                                    const speed = Math.floor(bytesDiff / timeDiff);
                                    console.log(`İndirme hızı hesaplandı: ${formatSpeed(speed)} (${bytesDiff} bytes / ${timeDiff.toFixed(2)}s)`);
                                    
                                    setDownloadSpeed(prev => ({
                                        ...prev,
                                        [fileId]: speed
                                    }));
                                    
                                    downloadLastBytes.current[fileId] = {
                                        bytes: currentBytes,
                                        time: currentTime,
                                        speedHistory: []
                                    };
                                }
                            }
                            
                            setDownloads(prev => {
                                const download = prev[fileId];
                                if (download) {
                                    return {
                                        ...prev,
                                        [fileId]: {
                                            ...download,
                                            progress: progress
                                        }
                                    };
                                }
                                return prev;
                            });
                        }
                        else if (data.message === "PREPARING") {
                            console.log("Dosya hazırlanıyor:", data.fileName, "İlerleme:", data.progress);
                            
                            const fileId = data.fileId!;
                            
                            // UI'da hazırlanıyor durumunu göster
                            setDownloads(prev => {
                                const download = prev[fileId];
                                if (download) {
                                    return {
                                        ...prev,
                                        [fileId]: {
                                            ...download,
                                            progress: data.progress || 99,
                                            status: 'preparing' // Özel durum: Hazırlanıyor
                                        }
                                    };
                                }
                                return prev;
                            });
                            
                            // Bilgilendirme mesajı göster
                            message.info(`"${data.fileName}" dosyası hazırlanıyor... Lütfen bekleyin.`);
                        }
                        else if (data.message === "COMPLETE" && data.file) {
                            console.log("Dosya indirme tamamlandı:", data.fileName, "Boyut:", data.file.size);
                            
                            const fileId = data.fileId!;
                            
                            // Dosyayı hemen indir, hash kontrolü bekleme
                            if (data.file && data.fileName) {
                                try {
                                    const url = URL.createObjectURL(data.file);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = data.fileName;
                                    document.body.appendChild(a);
                                    a.click();
                                    
                                    // Temizlik işlemleri için setTimeout kullan
                                    setTimeout(() => {
                                        URL.revokeObjectURL(url);
                                        document.body.removeChild(a);
                                    }, 100);
                                    
                                    message.success(`"${data.fileName}" dosyası indirildi`);
                                    
                                    // Göndericiye indirmenin tamamlandığını bildir
                                    if (connection.selectedId && data.peerId) {
                                        try {
                                            // Göndericiye dosya indirme tamamlandı bildirimi gönder
                                            PeerConnection.sendConnection(data.peerId, {
                                                dataType: DataType.FILE,
                                                message: "P2P_DOWNLOAD_COMPLETE",
                                                fileId: fileId,
                                                fileName: data.fileName,
                                                peerId: peer.id || ''
                                            });
                                            console.log(`Göndericiye (${data.peerId}) dosya indirme tamamlandı bildirimi gönderildi: ${fileId}`);
                                        } catch (err) {
                                            console.error("Göndericiye indirme tamamlandı bildirimi gönderilirken hata:", err);
                                        }
                                    }
                                } catch (error) {
                                    console.error("Dosya indirme hatası:", error);
                                    message.error(`"${data.fileName}" dosyası indirilirken hata oluştu`);
                                }
                            }
                            
                            setDownloads(prev => {
                                const download = prev[fileId];
                                if (download) {
                                    return {
                                        ...prev,
                                        [fileId]: {
                                            ...download,
                                            progress: 100,
                                            complete: true
                                        }
                                    };
                                }
                                return prev;
                            });
                            
                            setDownloadSpeed(prev => ({
                                ...prev,
                                [fileId]: 0
                            }));
                        }
                    } else if (data.dataType === DataType.FILE_HASH && data.fileId) {
                        // Hash bilgileri geldiğinde işle
                        if (data.fileHash) {
                            console.log(`Hash alındı: ${data.fileHash} (${data.message})`);
                            
                            // Hash değerini kaydet
                            const updatedHashes = new Map(fileHashes);
                            updatedHashes.set(data.fileId, data.fileHash);
                            setFileHashes(updatedHashes);
                            
                            // Hash durumunu güncelle
                            if (data.message === "HASH_MATCH" || data.message === "HASH_MISMATCH") {
                                const status = data.message === "HASH_MATCH" ? 'match' : 'mismatch';
                                const updatedHashStatus = new Map(hashStatus);
                                updatedHashStatus.set(data.fileId, status);
                                setHashStatus(updatedHashStatus);
                                
                                // Kullanıcıya bildirim göster
                                if (status === 'match') {
                                    message.success(`"${data.fileName}" dosyasının bütünlüğü doğrulandı`);
                                } else {
                                    message.error(`"${data.fileName}" dosyasının bütünlüğü doğrulanamadı!`);
                                }
                            } else if (data.message === "HASH_VALUE") {
                                // Gönderici tarafından gönderilen hash değeri, henüz karşılaştırma yapılmadı
                            }
                        }
                    } else if (data.dataType === DataType.RELAY_CHUNK_INFO && data.fileId) {
                        // Alıcı tarafından gelen parça yükleme taleplerine cevap ver
                        if (data.message === "MISSING_CHUNKS" && data.fileName) {
                            try {
                                // Eksik parça listesini fileName alanından ayıklayalım
                                const missingChunks = data.fileName.split(',').map(Number);
                                const fileId = data.fileId;
                                const sessionId = data.sessionId;
                                
                                console.log(`[Dosya Gönderim] Eksik parça yükleme talebi alındı: ${fileId}, ${missingChunks.length} parça`);
                                message.info(`"${fileId}" dosyası için eksik parça talebi alındı (${missingChunks.length} parça).`);
                                
                                // Bu dosya ve oturum için verilerin bulunduğu orijinal kaydı bulmamız gerekiyor
                                // Upload durumlarından dosya adını bulalım
                                const uploadKey = Object.keys(uploads).find(key => key.startsWith(fileId));
                                
                                if (uploadKey && uploads[uploadKey]?.fileName) {
                                    // Dosya adını bulduk, şimdi fileList'ten bu dosyayı alalım
                                    const fileName = uploads[uploadKey].fileName;
                                    const originalFile = fileList.find((f: UploadFile) => f.name === fileName) as unknown as File;
                                    
                                    if (originalFile) {
                                        console.log(`[Dosya Gönderim] Orijinal dosya bulundu: ${fileName}`);
                                        
                                        // Sunucu modülünü yükle
                                        const serverRelay = (await import('./helpers/server-relay')).default;
                                        
                                        // Sunucuya bağlan ve oturumu kontrol et
                                        let sessionActive = false;
                                        const currentSession = serverRelay.getSessionInfo();
                                        
                                        if (currentSession && currentSession.sessionId === sessionId) {
                                            // Mevcut oturum zaten aktif
                                            sessionActive = true;
                                        } else {
                                            // Yeni oturum başlat
                                            try {
                                                await serverRelay.startSession(peer.id || 'unknown');
                                                sessionActive = true;
                                            } catch (error) {
                                                console.error('[Dosya Gönderim] Sunucu oturumu başlatılamadı:', error);
                                                message.error('Sunucu bağlantısı kurulamadı, eksik parçalar yüklenemedi!');
                                            }
                                        }
                                        
                                        if (sessionActive) {
                                            // Eksik parçaları yükle
                                            const chunkSize = 1024 * 1024; // 1MB
                                            let uploadedCount = 0;
                                            
                                            for (const chunkIndex of missingChunks) {
                                                try {
                                                    const start = chunkIndex * chunkSize;
                                                    const end = Math.min(start + chunkSize, originalFile.size);
                                                    const chunk = originalFile.slice(start, end);
                                                    
                                                    console.log(`[Dosya Gönderim] Eksik parça yükleniyor: ${chunkIndex+1}/${missingChunks.length}`);
                                                    const uploadSuccess = await serverRelay.uploadChunk(fileId, chunkIndex, chunk);
                                                    
                                                    if (uploadSuccess) {
                                                        uploadedCount++;
                                                    } else {
                                                        console.error(`[Dosya Gönderim] Parça yükleme hatası: ${chunkIndex}`);
                                                    }
                                                } catch (chunkError) {
                                                    console.error(`[Dosya Gönderim] Parça yükleme hatası:`, chunkError);
                                                }
                                            }
                                            
                                            // Yükleme sonucunu bildir
                                            if (uploadedCount === missingChunks.length) {
                                                message.success(`Tüm eksik parçalar (${uploadedCount} adet) başarıyla yüklendi.`);
                                            } else {
                                                message.warning(`Eksik parçaların bir kısmı yüklendi: ${uploadedCount}/${missingChunks.length}`);
                                            }
                                        }
                                    } else {
                                        console.error(`[Dosya Gönderim] Talep edilen dosya fileList'te bulunamadı: ${fileName}`);
                                        message.error('Talep edilen dosya yerel listede bulunamadı!');
                                    }
                                } else {
                                    console.error(`[Dosya Gönderim] Talep edilen dosya uploads kayıtlarında bulunamadı: ${fileId}`);
                                    message.error('Talep edilen dosya kaydı bulunamadı!');
                                }
                            } catch (error) {
                                console.error('[Dosya Gönderim] Eksik parça işlerken hata:', error);
                                message.error('Eksik parçalar işlenirken bir hata oluştu!');
                            }
                        }
                    }
                    else if (data.dataType === DataType.RELAY_FILE_INFO) {
                        console.log("Gönderici sunucu üzerinden dosya göndermeye başlıyor:", data);
                        
                        const fileId = data.fileId!;
                        const fileName = data.fileName || "bilinmeyen dosya";
                        const fileSize = data.fileSize || 0;
                        const totalChunks = data.totalChunks || 0;
                        const sessionId = data.sessionId || '';
                        const senderId = data.peerId || '';
                        
                        // Sunucu üzerinden indirme işlemini başlat
                        downloadChunksFromServer(fileId, fileName, fileSize, totalChunks, sessionId, senderId, peer.id || '')
                            .then(file => {
                                if (file) {
                                    console.log("Dosya sunucudan başarıyla indirildi:", fileName);
                                    
                                    // Dosyayı kaydet
                                    saveAs(file, fileName);
                                    
                                    // İndirmeyi tamamlandı olarak işaretle
                                    setDownloads(prev => {
                                        return {
                                            ...prev,
                                            [fileId]: {
                                                ...prev[fileId],
                                                progress: 100,
                                                complete: true
                                            }
                                        };
                                    });
                                    
                                    // Gönderici tarafa indirme tamamlandı bildirimi gönder
                                    notifyDownloadComplete(fileId, sessionId, senderId);
                                } else {
                                    console.error("Dosya indirme işlemi başarısız oldu:", fileName);
                                }
                            })
                            .catch(error => {
                                console.error("Sunucu üzerinden indirme hatası:", error);
                                message.error(`${fileName} indirilemedi: ${error}`);
                                
                                // İndirme durumunu hata olarak işaretle
                                setDownloads(prev => {
                                    return {
                                        ...prev,
                                        [fileId]: {
                                            ...prev[fileId],
                                            error: true,
                                            stopped: true
                                        }
                                    };
                                });
                            });
                    }
                });
            } catch (error) {
                console.error("Dinleyici eklenirken hata:", error);
            }
        }
        
        return () => {
            if (connection.selectedId) {
                try {
                    PeerConnection.clearDataListeners(connection.selectedId);
                } catch (e) {
                    console.log("Dinleyici temizleme hatası:", e);
                }
            }
        };
    }, [connection.selectedId]);

    // Bağlantı ve yükleme durumlarını başlat
    useEffect(() => {
        // Başlangıç durumlarını sıfırla
        shouldStopAllUploads.current = false;
        receiverConnectionStatus.current = {};
        activeUploads.current = {};
        
        console.log("[UPLOAD MANAGER] Yükleme yöneticisi başlatıldı");
        
        return () => {
            // Temizlik kodu (gerekirse)
            shouldStopAllUploads.current = true;
        };
    }, []);

    const handleUpload = async () => {
        if (fileList.length === 0) {
            message.warning("Lütfen dosya seçin");
            return;
        }
        
        // Yükleme başlamadan önce global durumları sıfırla
        shouldStopAllUploads.current = false;
        
        // Alıcı bağlantı durumlarını sıfırla
        for (const receiverId of (multiSendMode ? selectedReceivers : [connection.selectedId!])) {
            receiverConnectionStatus.current[receiverId] = true;
        }
        
        console.log("[UPLOAD] Yeni yükleme başlatılıyor, tüm iptal bayrakları sıfırlandı.");
        
        if (multiSendMode) {
            // Çoklu alıcı modu
            if (selectedReceivers.length === 0) {
                message.warning("Lütfen en az bir alıcı seçin");
                return;
            }
        } else {
            // Tekli alıcı modu
        if (!connection.selectedId) {
            message.warning("Lütfen bir bağlantı seçin");
            return;
            }
        }
        
        if (sendLoading) {
            message.warning("Dosya gönderimi zaten devam ediyor, lütfen bekleyin");
            return;
        }
        
        try {
            await setSendLoading(true);
            
            // Hangi alıcılara gönderileceğini belirle
            const targetReceivers = multiSendMode ? selectedReceivers : [connection.selectedId!];
            
            // Sunucu üzerinden gönderim seçeneği etkin mi?
            if (useServerRelay) {
                try {
                    // Sunucu aktarım modülünü yükle
                    const serverRelay = (await import('./helpers/server-relay')).default;
                    
                    // Sunucu bağlantısını kontrol et
                    const isConnected = await serverRelay.checkServerConnection();
                    if (!isConnected) {
                        throw new Error("Sunucu bağlantısı kurulamadı");
                    }
                    
                    // Oturum başlatma
                    const sessionInfo = await serverRelay.startSession(peer.id || '');
                    setServerRelayStatus({
                        connected: true,
                        storageUsed: sessionInfo.storageUsed,
                        sessionId: sessionInfo.sessionId
                    });
                    
                    message.info(`${fileList.length} dosya, ${targetReceivers.length} alıcıya Dokimor sunucuları üzerinden gönderilecek`);
                    
                    // Her bir dosyayı sunucuya yükle
                    fileLoop: for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
                        // Bağlantı kesildi mi kontrol et
                        if (shouldStopAllUploads.current) {
                            console.log("Yükleme iptal edildi: Alıcı bağlantısı kesilmiş durumda");
                            break fileLoop;
                        }
                        
                        const file = fileList[fileIndex];
                        const originalFile = file as unknown as File;
                        const fileId = Math.random().toString(36).substring(2, 15);
                        
                        // Dosya boyutu ve parça sayısı
                        const chunkSize = 1024 * 1024; // 1MB
                        const totalChunks = Math.ceil(originalFile.size / chunkSize);
                        
                        console.log(`Dosya ${fileIndex+1}/${fileList.length}: ${originalFile.name}, ${originalFile.size} bayt, ${totalChunks} parça`);
                        
                        // İlk olarak tüm hedef alıcılar için yükleme durumunu oluştur
                        for (const peerId of targetReceivers) {
                            // Alıcı bağlantısı kesildi mi kontrol et
                            if (receiverConnectionStatus.current[peerId] === false) {
                                console.log(`Alıcı ${peerId} bağlantısı kesilmiş durumda, bu dosya için yükleme atlanıyor`);
                                continue fileLoop;
                            }
                            
                            const uploadKey = fileId + peerId;
                            
                            setUploads(prev => ({
                                ...prev,
                                [uploadKey]: {
                                    fileName: originalFile.name,
                                    progress: 0,
                                    fileSize: originalFile.size,
                                    complete: false,
                                    transferType: 'relay'
                                }
                            }));
                            
                            // Upload hız ölçümü için başlangıç değerlerini ayarla
                            uploadLastBytes.current[uploadKey] = {
                                bytes: 0,
                                time: Date.now(),
                                speedHistory: []
                            };
                            
                            setUploadSpeed(prev => ({
                                ...prev,
                                [uploadKey]: 0
                            }));
                        }
                        
                        // Dosyayı sunucu sistemine kaydet
                        const registerSuccess = await serverRelay.registerFile({
                            fileId,
                            fileName: originalFile.name,
                            fileSize: originalFile.size,
                            totalChunks
                        });
                        
                        if (!registerSuccess) {
                            throw new Error(`Dosya kaydedilemedi: ${originalFile.name}`);
                        }
                        
                        // Alıcılara dosya bilgilerini gönder, böylece indirmeye başlayabilirler
                        for (const peerId of targetReceivers) {
                            console.log(`Alıcıya dosya bilgisi gönderiliyor: ${peerId}`);
                            
                            // Alıcıya dosya bilgilerini gönder (alıcı indirmeye başlayabilir)
                            await PeerConnection.sendConnection(peerId, {
                                dataType: DataType.RELAY_FILE_INFO,
                                fileId: fileId,
                                fileName: originalFile.name,
                                fileSize: originalFile.size,
                                fileType: originalFile.type,
                                totalChunks: totalChunks,
                                sessionId: sessionInfo.sessionId,
                                peerId: peer.id || ''
                            });
                        }
                        
                        // Parçaları sunucuya yükle
                        let uploadedChunks = 0;
                        let uploadCancelled = false; // Yükleme iptal edildi mi kontrolü
                        
                        // Her parça yüklemeden önce iptal edilmiş mi kontrol et
                        const checkCancellation = () => {
                            // Global durdurma bayrağını kontrol et
                            if (shouldStopAllUploads.current) {
                                console.log(`[KRITIK_IPTAL] Global durma bayrağı aktif, yükleme durduruluyor: ${fileId}`);
                                uploadCancelled = true;
                                return true;
                            }
                            
                            // Herhangi bir alıcının bağlantısı kopmuş mu kontrol et
                            const anyReceiverDisconnected = targetReceivers.some(receiverId => 
                                receiverConnectionStatus.current[receiverId] === false
                            );
                            
                            if (anyReceiverDisconnected) {
                                console.log("[KRITIK_IPTAL] En az bir alıcı bağlantısı koptu, yükleme durduruluyor");
                                uploadCancelled = true;
                                return true;
                            }
                            
                            // Yüklemenin durdurulup durdurulmadığını kontrol et
                            const isUploadstopped = Object.keys(uploads).some(uploadKey => {
                                if (uploadKey.startsWith(fileId)) {
                                    return uploads[uploadKey].stopped;
                                }
                                return false;
                            });
                            
                            if (isUploadstopped) {
                                console.log(`[KRITIK_IPTAL] Yükleme durduruldu olarak işaretlenmiş: ${fileId}`);
                                uploadCancelled = true;
                                return true;
                            }
                            
                            return false; // İptal edilmemiş
                        };
                        
                        for (let i = 0; i < totalChunks; i++) {
                            // Parça yüklemeden önce iptal kontrolü
                            if (checkCancellation()) {
                                console.log(`[KRITIK_IPTAL] Parça ${i+1}/${totalChunks} yüklenmeden önce iptal edildi`);
                                break;
                            }
                            
                            const start = i * chunkSize;
                            const end = Math.min(start + chunkSize, originalFile.size);
                            const chunk = originalFile.slice(start, end);
                            
                            // Parçayı sunucuya yükle
                            try {
                                console.log(`Parça yükleniyor: ${i+1}/${totalChunks}`);
                                
                                // Bir kez daha iptal kontrolü
                                if (checkCancellation()) {
                                    console.log(`[KRITIK_IPTAL] Parça ${i+1}/${totalChunks} yükleme öncesi ikinci kontrol: İptal edildi`);
                                    break;
                                }
                                
                                const uploadSuccess = await serverRelay.uploadChunk(fileId, i, chunk);
                                
                                if (uploadSuccess) {
                                    uploadedChunks++;
                                    console.log(`Parça yüklendi: ${i+1}/${totalChunks}, Toplam: ${uploadedChunks}/${totalChunks}`);
                                    
                                    // Yükleme ilerleme oranını hesapla (0-100 arası)
                                    const progress = Math.floor((uploadedChunks / totalChunks) * 100);
                                    
                                    // Hızı güncelle
                                    if (uploadLastBytes.current) {
                                        // Her bir alıcı için hızı ayrı hesapla
                                        for (const peerId of targetReceivers) {
                                            const uploadKey = fileId + peerId;
                                            
                                            // Yükleme bittiğinde çalışan yükleme hızı hesaplayıcısı
                                            if (!uploadLastBytes.current[uploadKey]) {
                                                uploadLastBytes.current[uploadKey] = {
                                                    bytes: chunk.size,
                                                    time: Date.now(),
                                                    speedHistory: []
                                                };
                                            } else {
                                                const now = Date.now();
                                                const timeDiff = now - uploadLastBytes.current[uploadKey].time;
                                                
                                                if (timeDiff > 0) {
                                                    const bytesPerSecond = chunk.size / (timeDiff / 1000);
                                                    
                                                    // Hız geçmişini güncelle (son 5 hız ölçümünü sakla)
                                                    uploadLastBytes.current[uploadKey].speedHistory.push(bytesPerSecond);
                                                    uploadLastBytes.current[uploadKey].bytes = chunk.size;
                                                    uploadLastBytes.current[uploadKey].time = now;
                                                    
                                                    // Ortalama hızı hesapla
                                                    const averageSpeed = uploadLastBytes.current[uploadKey].speedHistory.reduce((a, b) => a + b, 0) / 
                                                        uploadLastBytes.current[uploadKey].speedHistory.length;
                                                    
                                                    // Hızı güncelle
                                                    setUploadSpeed(prev => ({
                                                        ...prev,
                                                        [uploadKey]: averageSpeed
                                                    }));
                                                    
                                                    // En fazla 5 hız kaydı tut
                                                    if (uploadLastBytes.current[uploadKey].speedHistory.length > 5) {
                                                        uploadLastBytes.current[uploadKey].speedHistory.shift();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    
                                    // İlerleme bilgisini güncelle - PARÇA YÜKLEME İLERLEMESİ
                                    // Burada ilerleme doğrudan %100'e gitmek yerine gerçek ilerlemeyi göster
                                    setUploads(prev => {
                                        // Her bir alıcı için ilerlemeyi güncelle
                                        const newUploads = { ...prev };
                                        for (const peerId of targetReceivers) {
                                            const uploadKey = fileId + peerId;
                                            const upload = prev[uploadKey];
                                            
                                            if (upload && !upload.stopped) {
                                                // İlerlemeyi gerçek yükleme durumuna göre güncelle
                                                newUploads[uploadKey] = {
                                                    ...upload,
                                                    progress: progress
                                                };
                                            }
                                        }
                                        return newUploads;
                                    });
                                }
                                
                                // Parça yükledikten sonra tekrar iptal kontrolü
                                if (checkCancellation()) {
                                    console.log(`[KRITIK_IPTAL] Parça ${i+1}/${totalChunks} yükleme sonrası: İptal edildi`);
                                    break;
                                }
                            } catch (chunkError) {
                                console.error(`Parça yükleme hatası: ${i}`, chunkError);
                                
                                // Hatada da iptal kontrolü
                                if (shouldStopAllUploads.current) {
                                    console.log(`[KRITIK_IPTAL] Parça ${i+1}/${totalChunks} yükleme hatası sonrası: İptal edildi`);
                                    uploadCancelled = true;
                                    break;
                                }
                            }
                        }
                        
                        // Yükleme iptal edildiyse, sunucu oturumunu temizle
                        if (uploadCancelled) {
                            try {
                                await serverRelay.cleanupSession();
                                console.log("Yükleme iptal edildiği için sunucu oturumu temizlendi");
                                continue; // Sonraki dosyaya geç
                            } catch (err) {
                                console.error("Yükleme iptali sonrası oturum temizleme hatası:", err);
                            }
                        }
                        
                        // Tüm parçalar yüklendikten sonra, alıcıların indirme işlemini izlemek için
                        // bir bekleme adımı ekle - doğrudan tamamlandı olarak işaretleme
                        console.log(`Tüm parçalar sunucuya yüklendi. Alıcıların indirme işlemini tamamlamaları bekleniyor...`);
                        message.info(`Tüm parçalar sunucuya yüklendi. Alıcıların indirme işlemini tamamlamaları bekleniyor...`);
                        
                        // Dosyayı tamamlanmış olarak işaretleme - sadece %90'a kadar getir
                        // Alıcı tarafı indirmeyi bitirdiğinde geri kalan %10 ilerleme tamamlanacak
                        for (const peerId of targetReceivers) {
                            const uploadKey = fileId + peerId;
                            
                            // İlerlemeyi %90'a getir, tam tamamlandı olarak işaretleme
                            setUploads(prev => {
                                const upload = prev[uploadKey];
                                if (upload && !upload.stopped) {
                                    console.log(`Yükleme: ${uploadKey} - İlerleme %90'a getirildi, alıcı tarafı tamamlanması bekleniyor`);
                                    return {
                                        ...prev,
                                        [uploadKey]: {
                                            ...upload,
                                            progress: 90, // %90'a getir, tam tamamlanmadı olarak işaretle
                                            complete: false // Hala tamamlanmadı
                                        }
                                    };
                                }
                                return prev;
                            });
                        }
                        
                        // Alıcı indirme durumlarını izlemek için bir dinleyici oluştur
                        // Bu dinleyici, alıcılar indirmeyi tamamladığında ilerleme çubuğunu %100'e getirecek
                        for (const peerId of targetReceivers) {
                            const uploadKey = fileId + peerId;
                            
                            // İndirme tamamlandığında bildirim gelecek olan bir dinleyici ekle
                            try {
                                console.log(`${peerId} alıcısı için indirme tamamlanma dinleyicisi ekleniyor...`);
                                
                                // İndirme tamamlandı bildirimini dinle
                                PeerConnection.onConnectionReceiveData(peerId, (data: Data) => {
                                    // İndirme tamamlanma mesajını kontrol et
                                    if (data.dataType === DataType.RELAY_DOWNLOAD_READY && data.fileId === fileId) {
                                        console.log(`Alıcı ${peerId} indirmeyi tamamladı: ${fileId}`);
                                        
                                        // Yüklemeyi tam olarak tamamlandı olarak işaretle
                                        setUploads(prev => {
                                            const upload = prev[uploadKey];
                                            if (upload && !upload.stopped) {
                                                return {
                                                    ...prev,
                                                    [uploadKey]: {
                                                        ...upload,
                                                        progress: 100, // %100'e getir
                                                        complete: true // Tamamlandı olarak işaretle
                                                    }
                                                };
                                            }
                                            return prev;
                                        });
                                        
                                        // Hız sıfırla
                                        setUploadSpeed(prev => ({
                                            ...prev,
                                            [uploadKey]: 0
                                        }));
                                        
                                        // İndirme tamamlanma mesajı göster
                                        message.success(`${uploadKey} dosyası alıcı tarafından başarıyla indirildi`);
                                    }
                                });
                            } catch (error) {
                                console.error(`Alıcı ${peerId} için dinleyici eklenirken hata:`, error);
                            }
                        }
                    }
                    
                    await setSendLoading(false);
                    message.success(`${fileList.length} dosya, ${targetReceivers.length} alıcıya başarıyla gönderildi`);
                    setFileList([]);
                    
                } catch (error) {
                    console.error("Sunucu üzerinden aktarım hatası:", error);
                    await setSendLoading(false);
                    message.error("Dokimor sunucuları üzerinden aktarım başarısız oldu!");
                    
                    // Tüm aktif yüklemeleri durduruldu olarak işaretle
                    setUploads(prev => {
                        const newUploads = { ...prev };
                        Object.keys(newUploads).forEach(key => {
                            const upload = newUploads[key];
                            if (!upload.complete && upload.transferType === 'relay') {
                                newUploads[key] = {
                                    ...upload,
                                    error: true,
                                    stopped: true
                                };
                            }
                        });
                        return newUploads;
                    });
                    
                    // Sunucu oturumunu temizlemeyi dene
                    try {
                        const serverRelay = (await import('./helpers/server-relay')).default;
                        await serverRelay.cleanupSession();
                        console.log("Yükleme hatası sonrası sunucu oturumu temizlendi");
                    } catch (cleanupError) {
                        console.error("Oturum temizlenirken hata:", cleanupError);
                    }
                }
            } else {
                // Normal P2P aktarım (mevcut kod)
                message.info(`${fileList.length} dosya, ${targetReceivers.length} alıcıya gönderilecek`);
                
                // Her bir dosya ve bağlantı için paralelde gönderim başlat
                const allTransferPromises: Promise<void>[] = [];
                
                // Leecher sisteminde her alıcı paylaşımın bir parçası olur
                for (const file of fileList) {
                    const originalFile = file as unknown as File;
                    const blob = new Blob([originalFile], { type: originalFile.type });
                    const fileId = Math.random().toString(36).substring(2, 15);
                    
                    // Her alıcı için görev oluştur
                    for (const peerId of targetReceivers) {
            const startTime = Date.now();
            
                        uploadLastBytes.current[fileId + peerId] = {
                bytes: 0,
                time: startTime,
                speedHistory: []
            };
            
            setUploadSpeed(prev => ({
                ...prev,
                            [fileId + peerId]: 0
            }));
            
            setUploads(prev => ({
                ...prev,
                            [fileId + peerId]: {
                                fileName: originalFile.name,
                    progress: 0,
                                fileSize: originalFile.size,
                    complete: false,
                    transferType: 'p2p'
                }
            }));
            
                        console.log(`Dosya gönderimi başlatılıyor: ${originalFile.name} -> ${peerId} (${fileId})`);
            
            let lastUpdateTime = startTime;
            let lastBytes = 0;
            let speedMeasurements: number[] = [];
            
                        // Her alıcı için görev oluştur ve promise dizisine ekle
                        const transferPromise = PeerConnection.sendConnection(
                            peerId, 
                {
                    dataType: DataType.FILE,
                    file: blob,
                                fileName: originalFile.name,
                                fileType: originalFile.type
                },
                (progress) => {
                    const currentTime = Date.now();
                    const currentBytes = Math.floor(progress / 100 * originalFile.size);
                    const bytesDiff = currentBytes - lastBytes;
                    const timeDiff = (currentTime - lastUpdateTime) / 1000;
                    
                    if (timeDiff > 0 && bytesDiff > 0) {
                        const speed = Math.floor(bytesDiff / timeDiff);
                        
                        speedMeasurements.push(speed);
                        if (speedMeasurements.length > 5) {
                            speedMeasurements.shift();
                        }
                        
                        const avgSpeed = Math.floor(speedMeasurements.reduce((a, b) => a + b, 0) / speedMeasurements.length);
                        
                        setUploadSpeed(prev => ({
                            ...prev,
                            [fileId + peerId]: avgSpeed
                        }));
                        
                        lastBytes = currentBytes;
                        lastUpdateTime = currentTime;
                    }
                    
                    // İlerleme güncellemesi - gerçek ilerlemeyi kullan
                    setUploads(prev => {
                        const upload = prev[fileId + peerId];
                        if (upload && !upload.stopped) {
                            console.log(`Dosya yükleme ilerleme: ${fileId + peerId}, İlerleme: %${progress.toFixed(1)}`);
                            return {
                                ...prev,
                                [fileId + peerId]: {
                                    ...upload,
                                    progress: Math.round(progress), // Gerçek yükleme ilerlemesini kullan
                                    complete: progress >= 99.9 // Sadece %99.9'dan büyükse tamamlandı olarak işaretle
                                }
                            };
                        }
                        return prev;
                    });
                }
            );
            
                        allTransferPromises.push(transferPromise);
                    }
                }
                
                // Tüm gönderim işlemlerinin tamamlanmasını bekle
                await Promise.all(allTransferPromises);
                
                await setSendLoading(false);
                message.success(`${fileList.length} dosya, ${targetReceivers.length} alıcıya başarıyla gönderildi`);
            setFileList([]);
            }
            
        } catch (err) {
            console.error("Dosya gönderme hatası:", err);
            await setSendLoading(false);
            message.error("Dosya gönderilirken hata oluştu");
        }
    };

    const formatSpeed = (bytesPerSecond: number): string => {
        if (bytesPerSecond === 0) return '0 B/s';
        if (bytesPerSecond < 1024) return `${bytesPerSecond} B/s`;
        if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    };

    // Sayfa kapanırken veya komponent unmount olduğunda sunucu oturumunu temizle
    useEffect(() => {
        // Sayfa kapanma veya yenileme olayını dinle
        const handleUnload = async () => {
            // Aktif sunucu oturumu varsa temizle
            if (useServerRelay && serverRelayStatus.connected) {
                try {
                    // server-relay modülünü dinamik olarak yükle
                    const module = await import('./helpers/server-relay');
                    await module.default.cleanupSession();
                    console.log("Tarayıcı kapanırken sunucu oturumu temizlendi");
                } catch (err) {
                    console.error("Sunucu oturumu temizlenirken hata:", err);
                }
            }
        };

        // beforeunload olayını dinle
        window.addEventListener('beforeunload', handleUnload);
        
        return () => {
            // Sayfa kapanırken veya komponent unmount olduğunda
            window.removeEventListener('beforeunload', handleUnload);
            
            if (useServerRelay && serverRelayStatus.connected) {
                import('./helpers/server-relay').then(module => {
                    module.default.cleanupSession().then(() => {
                        console.log("Sunucu oturumu temizlendi");
                    });
                }).catch(err => {
                    console.error("Sunucu oturumu temizlenirken hata:", err);
                });
            }
        };
    }, [useServerRelay, serverRelayStatus]);

    // İnternet bağlantısı değiştiğinde dosya durumlarını güncelle
    useEffect(() => {
        const handleOffline = () => {
            console.log("İnternet bağlantısı kesildi");
            // Aktif indirme ve yüklemeleri durduruldu olarak işaretle
            if (useServerRelay) {
                // Sunucu üzerinden olan aktarımları durduruldu olarak işaretle
                
                // İndirmeleri güncelle
                setDownloads(prev => {
                    const newDownloads = { ...prev };
                    
                    // Sadece devam eden indirmeleri durduruldu olarak işaretle
                    Object.keys(newDownloads).forEach(fileId => {
                        const download = newDownloads[fileId];
                        if (!download.complete && download.transferType === 'relay') {
                            newDownloads[fileId] = {
                                ...download,
                                stopped: true
                            };
                        }
                    });
                    
                    return newDownloads;
                });
                
                // Yüklemeleri güncelle
                setUploads(prev => {
                    const newUploads = { ...prev };
                    
                    // Sadece devam eden yüklemeleri durduruldu olarak işaretle
                    Object.keys(newUploads).forEach(fileId => {
                        const upload = newUploads[fileId];
                        if (!upload.complete && upload.transferType === 'relay') {
                            newUploads[fileId] = {
                                ...upload,
                                stopped: true
                            };
                        }
                    });
                    
                    return newUploads;
                });
                
                // Kullanıcıya bildirim göster
                message.error("İnternet bağlantısı kesildi. Sunucu üzerinden dosya aktarımları durduruldu.");
            }
        };
        
        const handleOnline = () => {
            console.log("İnternet bağlantısı tekrar sağlandı");
            // Kullanıcıya bildirim göster
            message.info("İnternet bağlantısı tekrar sağlandı. Duran aktarımlar devam etmeyecek.");
        };
        
        // Online/offline olaylarını dinle
        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);
        
        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
        };
    }, [useServerRelay]);

    // Dosya transferi için ping-pong kontrolü
    const [serverPingInterval, setServerPingInterval] = useState<NodeJS.Timeout | null>(null);
    const [serverPingFailed, setServerPingFailed] = useState<boolean>(false);
    const receiverConnections = useRef<Set<string>>(new Set());
    
    // Alıcı bağlantılarını izleme ve koptuğunda oturumu temizleme
    useEffect(() => {
        // Alıcılara ping gönderen ve yanıt alamadığında aktarımı durduran mekanizma
        if (useServerRelay && serverRelayStatus.connected) {
            // Yeni alıcı listesini oluştur - ping kontrolü için
            const currentReceivers = new Set(Object.keys(uploads)
                .filter(key => uploads[key].transferType === 'relay' && !uploads[key].complete)
                .map(key => {
                    // fileId+peerId formatından peerId'yi ayıklama
                    if (key.length > 13) {
                        return key.substring(13); // Kalan kısım alıcı ID'si
                    }
                    return '';
                })
                .filter(id => id !== '')
            );
            
            // Alıcı listesini güncelle
            receiverConnections.current = currentReceivers;
            
            if (currentReceivers.size > 0 && !serverPingInterval) {
                // Her 5 saniyede bir ping gönder ve yanıt alamayanları kontrol et
                const interval = setInterval(async () => {
                    // Her alıcıya ping gönder
                    const alivePromises = Array.from(currentReceivers).map(async (peerId) => {
                        try {
                            // Ping mesajı gönder
                            await PeerConnection.sendConnection(peerId, {
                                dataType: DataType.PING,
                                message: "ping"
                            });
                            return { peerId, alive: true };
                        } catch (err) {
                            console.error(`Alıcıya ping gönderilemedi: ${peerId}`, err);
                            return { peerId, alive: false };
                        }
                    });
                    
                    // Ping sonuçlarını al
                    const results = await Promise.all(alivePromises);
                    
                    // Bağlantısı kopan alıcıları belirle
                    const disconnectedReceivers = results.filter(r => !r.alive).map(r => r.peerId);
                    
                    // Bağlantı kopan alıcı varsa ve sunucu üzerinden aktarım yapılıyorsa
                    if (disconnectedReceivers.length > 0) {
                        console.log(`Bağlantısı kopan alıcılar: ${disconnectedReceivers.join(', ')}`);
                        
                        // Bu alıcılara olan aktarımları durduruldu olarak işaretle
                        setUploads(prev => {
                            const newUploads = { ...prev };
                            
                            // Sadece bağlantısı kopan alıcılara ait yüklemeleri durdur
                            Object.keys(newUploads).forEach(key => {
                                // fileId+peerId formatından peerId'yi ayıklama
                                let peerId = '';
                                if (key.length > 13) {
                                    peerId = key.substring(13); // Kalan kısım alıcı ID'si
                                }
                                
                                const upload = newUploads[key];
                                if (peerId && disconnectedReceivers.includes(peerId) && !upload.complete && upload.transferType === 'relay') {
                                    newUploads[key] = {
                                        ...upload,
                                        stopped: true
                                    };
                                }
                            });
                            
                            return newUploads;
                        });
                        
                        // Aktif aktarım kalmadı ise sunucu oturumunu temizle
                        const activeUploadsRemain = Object.values(uploads).some(
                            upload => !upload.complete && !upload.stopped && upload.transferType === 'relay'
                        );
                        
                        if (!activeUploadsRemain) {
                            // Sunucu oturumunu temizle
                            try {
                                const serverRelay = (await import('./helpers/server-relay')).default;
                                await serverRelay.cleanupSession();
                                console.log("Alıcı bağlantısı koptuğu için sunucu oturumu temizlendi");
                                
                                // Server ping kontrolünü durdur
                                if (serverPingInterval) {
                                    clearInterval(serverPingInterval);
                                    setServerPingInterval(null);
                                }
                                
                                message.warning("Tüm alıcılar bağlantıyı kapattığı için sunucu aktarımı durduruldu");
                            } catch (err) {
                                console.error("Sunucu oturumu temizlenirken hata:", err);
                            }
                        }
                    }
                }, 5000);
                
                setServerPingInterval(interval);
                
                return () => {
                    clearInterval(interval);
                    setServerPingInterval(null);
                };
            }
        } else if (serverPingInterval) {
            // Sunucu modu kapatıldığında interval'i temizle
            clearInterval(serverPingInterval);
            setServerPingInterval(null);
        }
    }, [useServerRelay, serverRelayStatus, uploads]);

    // PING mesajlarına yanıt ver ve gönderici durumunu kontrol et
    useEffect(() => {
        if (connection.selectedId) {
            const handlePingResponse = (data: Data) => {
                if (data.dataType === DataType.PING) {
                    // PING mesajına PONG ile yanıt ver
                    try {
                        // peerId veya connection.selectedId null veya undefined ise boş string kullan
                        const targetId = data.peerId || connection.selectedId || '';
                        if (targetId) {
                            PeerConnection.sendConnection(targetId, {
                                dataType: DataType.PING,
                                message: "pong",
                                peerId: peer.id || ''
                            });
                        }
                    } catch (err) {
                        console.error("PING yanıtı gönderilemedi", err);
                    }
                }
            };
            
            // Gönderici bağlantısını izle
            try {
                PeerConnection.onConnectionReceiveData(connection.selectedId || '', handlePingResponse);
            } catch (err) {
                console.error("PING dinleyicisi eklenirken hata:", err);
            }
            
            return () => {
                try {
                    // Dinleyiciyi temizle
                    if (connection.selectedId) {
                        PeerConnection.clearDataListeners(connection.selectedId);
                    }
                } catch (err) {
                    console.error("PING dinleyicisi temizlenirken hata:", err);
                }
            };
        }
    }, [connection.selectedId, peer.id]);
    
    // Sunucu ile indirme yapıyorken gönderici bağlantısını kontrol et
    const [senderPingInterval, setSenderPingInterval] = useState<NodeJS.Timeout | null>(null);
    
    useEffect(() => {
        // İndirme yapılırken gönderici bağlantısını kontrol et
        const relayDownloads = Object.entries(downloads).filter(
            ([fileId, download]) => download.transferType === 'relay' && !download.complete && !download.stopped
        );
        
        if (relayDownloads.length > 0 && connection.selectedId && peer.started) {
            // Gönderici bağlantısını periyodik olarak kontrol et
            if (!senderPingInterval) {
                const interval = setInterval(async () => {
                    try {
                        // Gönderici ile ping yaparak bağlantı kontrolü
                        if (connection.selectedId) {
                            await PeerConnection.sendConnection(connection.selectedId, {
                                dataType: DataType.PING,
                                message: "ping",
                                peerId: peer.id || ''
                            });
                        }
                    } catch (err) {
                        console.error("Gönderici bağlantısı koptu:", err);
                        
                        // Tüm aktif relay indirmelerini durdur
                        setDownloads(prev => {
                            const newDownloads = { ...prev };
                            
                            Object.keys(newDownloads).forEach(fileId => {
                                const download = newDownloads[fileId];
                                if (download.transferType === 'relay' && !download.complete && !download.stopped) {
                                    newDownloads[fileId] = {
                                        ...download,
                                        stopped: true
                                    };
                                }
                            });
                            
                            return newDownloads;
                        });
                        
                        // Sunucu oturumunu temizle
                        try {
                            const serverRelay = (await import('./helpers/server-relay')).default;
                            await serverRelay.cleanupSession();
                            console.log("Gönderici bağlantısı koptuğu için sunucu oturumu temizlendi");
                            
                            // Kullanıcıya bildir
                            message.error("Gönderici bağlantısı koptu. İndirme işlemi durduruldu.");
                            
                            // Ping kontrolünü durdur
                            if (senderPingInterval) {
                                clearInterval(senderPingInterval);
                                setSenderPingInterval(null);
                            }
                        } catch (cleanupErr) {
                            console.error("Sunucu oturumu temizlenirken hata:", cleanupErr);
                        }
                    }
                }, 5000);
                
                setSenderPingInterval(interval);
                
                return () => {
                    clearInterval(interval);
                    setSenderPingInterval(null);
                };
            }
        } else if (senderPingInterval) {
            // Tüm indirmeler tamamlandığında interval'i temizle
            clearInterval(senderPingInterval);
            setSenderPingInterval(null);
        }
    }, [downloads, connection.selectedId, peer.id, peer.started]);

    // Alıcı tarafı için bağlantı izleme ve durdurma mantığı
    useEffect(() => {
        const relayDownloads = Object.entries(downloads).filter(
            ([fileId, download]) => download.transferType === 'relay' && !download.complete && !download.stopped
        );
        
        // Sunucu üzerinden aktif indirme var ve gönderici bağlantısı varsa
        if (relayDownloads.length > 0 && connection.selectedId) {
            // Bağlantıyı kontrol et
            const checkConnection = async () => {
                try {
                    if (connection.selectedId) {
                        // Ping gönder ve cevap bekle
                        const pingStart = Date.now();
                        await PeerConnection.sendConnection(connection.selectedId, {
                            dataType: DataType.PING,
                            message: "ping",
                            peerId: peer.id || ''
                        });
                        
                        // 3 saniye içinde cevap gelmediyse bağlantı kopmuş kabul et
                        const pingTimeout = setTimeout(async () => {
                            console.log("Alıcı: Gönderici bağlantısı tespit edilemedi (timeout), indirme durdurulacak");
                            await handleReceiverDisconnection();
                        }, 3000);
                        
                        // Ping yanıtı dinleyicisi ekle
                        const pingListener = (data: Data) => {
                            if (data.dataType === DataType.PING && data.message === "pong") {
                                clearTimeout(pingTimeout); // Cevap geldiği için timeout iptal et
                                console.log(`Gönderici ping yanıtı alındı: ${Date.now() - pingStart}ms`);
                            }
                        };
                        
                        // Yanıt dinleyicisini ekle ve temizle
                        PeerConnection.onConnectionReceiveData(connection.selectedId, pingListener);
                        setTimeout(() => {
                            try {
                                PeerConnection.clearDataListeners(connection.selectedId!);
                            } catch (e) {
                                console.error("Ping dinleyici temizleme hatası:", e);
                            }
                        }, 3500);
                    }
                } catch (err) {
                    console.log("Alıcı: Gönderici bağlantısı tespit edilemedi, indirme durdurulacak");
                    // Bağlantı koptuğunda aktif indirmeleri durdur ve sunucu oturumunu temizle
                    await handleReceiverDisconnection();
                }
            };
            
            // İlk başta bağlantı kontrolü yapma - 3 saniye bekle
            const pingInterval = setTimeout(() => {
                // İlk kontrolü yap
                checkConnection();
                
                // Sonra düzenli aralıklarla kontrol et
                const interval = setInterval(checkConnection, 5000);
                // cleanup
                return () => clearInterval(interval);
            }, 3000);
            
            return () => {
                clearTimeout(pingInterval);
            };
        }
    }, [connection.selectedId, downloads]);
    
    // Gönderici tarafı için bağlantı izleme ve durdurma mantığı
    useEffect(() => {
        // PingReceivers işlevi dışında, global bir iptal bayrağı oluştur
        // Bu bayrak sadece bu useEffect içinde ve her render'da sıfırlanacak
        const localCancelToken = { cancelled: false };
        
        const relayUploads = Object.entries(uploads).filter(
            ([fileId, upload]) => upload.transferType === 'relay' && !upload.complete && !upload.stopped
        );
        
        // Aktif relay yüklemeleri varsa ve henüz durdurmadıysak
        if (relayUploads.length > 0) {
            // Alıcıların bağlantısını düzenli olarak kontrol et
            const pingReceivers = async () => {
                try {
                    // Tüm alıcılara ping gönder
                    const receiverIds = new Set(
                        Object.keys(uploads)
                            .filter(key => uploads[key].transferType === 'relay' && !uploads[key].complete && !uploads[key].stopped)
                            .map(key => {
                                // fileId+peerId formatından peerId'yi ayıklama
                                if (key.length > 13) {
                                    return key.substring(13); // Kalan kısım alıcı ID'si
                                }
                                return '';
                            })
                            .filter(id => id !== '')
                    );
                    
                    // Alıcı olmadığında çık
                    if (receiverIds.size === 0) {
                        console.log("Aktif alıcı bulunamadı, ping kontrolü yapılmıyor");
                        return;
                    }
                    
                    console.log(`[PING] ${receiverIds.size} alıcı için ping gönderiliyor...`);
                    
                    // Her alıcıya ping gönder
                    let allDisconnected = true;
                    for (const receiverId of Array.from(receiverIds)) {
                        try {
                            // Alıcı ID'si boş olabilir, kontrol et
                            if (!receiverId) {
                                continue;
                            }
                            
                            await PeerConnection.sendConnection(receiverId, {
                                dataType: DataType.PING,
                                message: "ping",
                                peerId: peer.id || ''
                            });
                            
                            // Ping başarılı oldu, en az bir alıcı bağlı
                            allDisconnected = false;
                            console.log(`[PING] Alıcı ${receiverId} bağlantısı aktif`);
                        } catch (err) {
                            console.error(`[PING_HATA] Alıcı ${receiverId} bağlantısı koptu!`);
                            
                            // Bu useEffect içindeki yerel iptal bayrağını ayarla
                            localCancelToken.cancelled = true;
                            
                            // Global durdurma bayrağını ayarla
                            shouldStopAllUploads.current = true;
                            
                            // Alıcı bağlantısı koptu, tüm ilgili yüklemeleri durdur
                            setUploads(prev => {
                                const newUploads = { ...prev };
                                Object.keys(newUploads).forEach(key => {
                                    if (key.includes(receiverId) && newUploads[key].transferType === 'relay') {
                                        newUploads[key] = {
                                            ...newUploads[key],
                                            stopped: true,
                                            error: true
                                        };
                                    }
                                });
                                return newUploads;
                            });
                            
                            // Kullanıcıya bildir
                            message.error(`Alıcı ${receiverId} bağlantısı koptu. Dosya gönderimi durduruldu.`);
                            
                            // Sunucu oturumunu temizle - bu çok önemli!
                            try {
                                const serverRelay = (await import('./helpers/server-relay')).default;
                                
                                // Önce server-relay'deki tüm işlemleri iptal et
                                serverRelay.abortAllOperations();
                                console.log(`[KRITIK_IPTAL] Tüm serverRelay işlemleri iptal edildi!`);
                                
                                // Sonra oturumu temizle
                                await serverRelay.cleanupSession();
                                console.log(`[KRITIK_IPTAL] Sunucu oturumu temizlendi, alıcı bağlantısı koptu: ${receiverId}`);
                            } catch (cleanupError) {
                                console.error("[PING] Oturum temizleme hatası:", cleanupError);
                            }
                        }
                    }
                    
                    // Tüm alıcılar bağlantıyı kopardıysa sunucu oturumunu temizle
                    if (allDisconnected && receiverIds.size > 0) {
                        await handleSenderDisconnection();
                    }
                } catch (pingError) {
                    console.error("[PING] Ping gönderme hatası:", pingError);
                }
            };
            
            // İlk başta bir kez ping gönder
            pingReceivers();
            
            // Daha kısa aralıklarla ping kontrolü yap (3 saniyede bir)
            const pingInterval = setInterval(pingReceivers, 3000);
            
            return () => {
                clearInterval(pingInterval);
            };
        }
    }, [uploads, peer.id]);
    
    // Alıcı bağlantı koptuğunda çağrılacak fonksiyon
    const handleReceiverDisconnection = async () => {
        // Tüm aktif relay indirmelerini durdur
        setDownloads(prev => {
            const newDownloads = { ...prev };
            Object.keys(newDownloads).forEach(fileId => {
                const download = newDownloads[fileId];
                if (download.transferType === 'relay' && !download.complete && !download.stopped) {
                    newDownloads[fileId] = {
                        ...download,
                        stopped: true,
                        error: true // Hata durumu olarak işaretle
                    };
                }
            });
            return newDownloads;
        });
        
        // Sunucu oturumunu temizle
        try {
            const serverRelay = (await import('./helpers/server-relay')).default;
            await serverRelay.cleanupSession();
            console.log("Alıcı: Gönderici bağlantısı koptu, sunucu oturumu temizlendi");
            message.error("Gönderici bağlantısı koptu. İndirme işlemi durduruldu.");
        } catch (err) {
            console.error("Sunucu oturumu temizlenirken hata:", err);
        }
    };
    
    // Gönderici bağlantı koptuğunda çağrılacak fonksiyon
    const handleSenderDisconnection = async () => {
        // Tüm aktif relay yüklemelerini durdur
        setUploads(prev => {
            const newUploads = { ...prev };
            Object.keys(newUploads).forEach(key => {
                const upload = newUploads[key];
                if (upload.transferType === 'relay' && !upload.complete && !upload.stopped) {
                    newUploads[key] = {
                        ...upload,
                        stopped: true,
                        error: true  // Hata durumu olarak işaretle
                    };
                }
            });
            return newUploads;
        });
        
        // Sunucu oturumunu temizle
        try {
            const serverRelay = (await import('./helpers/server-relay')).default;
            await serverRelay.cleanupSession();
            console.log("Gönderici: Tüm alıcıların bağlantısı koptu, sunucu oturumu temizlendi");
            message.error("Tüm alıcıların bağlantısı koptu. Yükleme işlemi durduruldu.");
        } catch (err) {
            console.error("Sunucu oturumu temizlenirken hata:", err);
        }
    };

    // İndirme tamamlandı, gönderici tarafa bildirim gönder
    const notifyDownloadComplete = async (fileId: string, sessionId: string, senderId: string) => {
        try {
            // Gönderici ID varsa, indirme tamamlandı bildirimi gönder
            if (senderId) {
                console.log(`Gönderici ${senderId}'ye indirme tamamlandı bildirimi gönderiliyor: ${fileId}`);
                
                // İndirme tamamlandı mesajı gönder
                await PeerConnection.sendConnection(senderId, {
                    dataType: DataType.RELAY_DOWNLOAD_READY,
                    fileId: fileId,
                    sessionId: sessionId,
                    message: "İndirme tamamlandı",
                    peerId: peer.id || ''
                });
                
                console.log(`İndirme tamamlandı bildirimi gönderildi: ${fileId}`);
            }
        } catch (error) {
            console.error(`İndirme tamamlandı bildirimi gönderilirken hata:`, error);
        }
    };

    // Sunucu üzerinden parça indirme işlemi
    const downloadChunksFromServer = async (fileId: string, fileName: string, fileSize: number, totalChunks: number, sessionId: string, senderId: string, peerId: string): Promise<Blob | null> => {
        try {
            // Sunucu API'sini dinamik olarak yükle
            const serverRelayModule = await import('./helpers/server-relay');
            const serverRelay = serverRelayModule.default;
            
            // İndirme durumunu izlemek için değişkenler
            let downloadedChunks = 0;
            let lastProgressUpdate = 0;
            
            // Sunucu oturumunu başlat
            // await serverRelay.continueSession(sessionId);
            // Oturumu sürdürme özelliği olmadığı için mevcut oturumu kullan
            
            // İndirme durumunu hazırla
            setDownloads(prev => ({
                ...prev,
                [fileId]: {
                    fileName: fileName,
                    progress: 0,
                    fileSize: fileSize,
                    complete: false,
                    transferType: 'relay'
                }
            }));
            
            // İndirme başlangıcını bildirme
            console.log("Sunucudan dosya indirme başladı:", fileName, "Boyut:", fileSize);
            
            // Hız ölçümü için başlangıç değerlerini ayarla
            downloadLastBytes.current[fileId] = {
                bytes: 0,
                time: Date.now(),
                speedHistory: []
            };
            
            // Sunucudan parçaları indir
            const chunks: Blob[] = new Array(totalChunks);
            const chunkSize = Math.ceil(fileSize / totalChunks);
            
            // Parça indirme işlemlerini asenkron olarak gerçekleştir
            const downloadTasks = Array.from({ length: totalChunks }, async (_, chunkIndex) => {
                // Bağlantı koparsa veya indirme durdurulursa işlemi iptal et
                if (isDownloadStopped(fileId)) {
                    console.log(`[Dosya İndirme] ${fileName} indirmesi durduruldu, parça ${chunkIndex} indirilmeyecek`);
                    return null;
                }
                
                try {
                    // Parçayı indir (maksimum 3 deneme)
                    for (let attempt = 0; attempt < 3; attempt++) {
                        // Bağlantı koparsa veya indirme durdurulursa işlemi iptal et
                        if (isDownloadStopped(fileId)) {
                            return null;
                        }
                        
                        try {
                            // Parçayı indir
                            const chunk = await serverRelay.downloadChunk(fileId, chunkIndex, peerId);
                            if (!chunk) {
                                console.error(`[Dosya İndirme] Parça ${chunkIndex} indirilemedi (Deneme ${attempt+1}/3)`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                continue;
                            }
                            
                            // Başarılı indirme
                            chunks[chunkIndex] = chunk;
                            downloadedChunks++;
                            
                            // İlerleme durumunu güncelle (çok sık güncelleme yapma)
                            const progress = Math.floor((downloadedChunks / totalChunks) * 100);
                            const downloadedBytes = downloadedChunks * chunkSize;
                            const currentTime = Date.now();
                            
                            // En az 500ms geçtiyse veya ilerleme %10'dan fazla değiştiyse UI'yı güncelle
                            if (currentTime - lastProgressUpdate > 500 || Math.abs(progress - lastProgressUpdate) >= 10) {
                                lastProgressUpdate = currentTime;
                                
                                // İlerlemeyi güncelle
                                setDownloads(prev => {
                                    if (!prev[fileId] || prev[fileId].stopped) return prev;
                                    return {
                                        ...prev,
                                        [fileId]: {
                                            ...prev[fileId],
                                            progress: progress
                                        }
                                    };
                                });
                                
                                // Hız hesaplaması
                                if (downloadLastBytes.current[fileId]) {
                                    const currentTime = Date.now();
                                    
                                    // Yumuşatılmış hız hesaplama fonksiyonunu kullan
                                    const smoothedSpeed = calculateSmoothedSpeed(
                                        downloadedBytes, 
                                        downloadLastBytes.current[fileId], 
                                        currentTime, 
                                        true
                                    );
                                    
                                    // Hız değerini güncelle
                                    setDownloadSpeed(prev => ({
                                        ...prev,
                                        [fileId]: smoothedSpeed
                                    }));
                                    
                                    // Son bayt, zaman ve hız geçmişi bilgisini güncelle
                                    const currentSpeedHistory = 
                                        downloadLastBytes.current[fileId].speedHistory.length > 0
                                            ? [...downloadLastBytes.current[fileId].speedHistory]
                                            : [];
                                    
                                    downloadLastBytes.current[fileId] = {
                                        bytes: downloadedBytes,
                                        time: currentTime,
                                        speedHistory: currentSpeedHistory
                                    };
                                    
                                    // Yeni hız ölçümünü ekle
                                    if (smoothedSpeed > 0) {
                                        downloadLastBytes.current[fileId].speedHistory.push(smoothedSpeed);
                                        if (downloadLastBytes.current[fileId].speedHistory.length > 5) {
                                            downloadLastBytes.current[fileId].speedHistory.shift();
                                        }
                                    }
                                }
                            }
                            
                            return chunk;
                        } catch (chunkError) {
                            console.error(`[Dosya İndirme] Parça ${chunkIndex} indirme hatası:`, chunkError);
                            if (attempt < 2) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[Dosya İndirme] Parça ${chunkIndex} indirme işlemi başarısız:`, error);
                }
                
                return null;
            });
            
            // Tüm parçaların indirilmesini bekle
            await Promise.all(downloadTasks);
            
            // Bağlantı koparsa veya indirme durdurulursa işlemi iptal et
            if (isDownloadStopped(fileId)) {
                console.log(`[Dosya İndirme] ${fileName} indirmesi durduruldu, dosya birleştirilmeyecek`);
                await serverRelay.cleanupSession();
                return null;
            }
            
            // Eksik parça kontrolü
            const missingChunks = chunks.findIndex(chunk => !chunk);
            if (missingChunks !== -1) {
                console.error(`[Dosya İndirme] Eksik parçalar var, parça ${missingChunks} bulunamadı`);
                await serverRelay.cleanupSession();
                
                // İndirme durumunu hata olarak işaretle
                setDownloads(prev => {
                    return {
                        ...prev,
                        [fileId]: {
                            ...prev[fileId],
                            error: true,
                            stopped: true
                        }
                    };
                });
                
                message.error(`${fileName} indirilemedi: Eksik parçalar var`);
                return null;
            }
            
            // İndirme tamamlandı
            setDownloads(prev => {
                return {
                    ...prev,
                    [fileId]: {
                        ...prev[fileId],
                        progress: 100,
                        complete: true
                    }
                };
            });
            
            setDownloadSpeed(prev => ({
                ...prev,
                [fileId]: 0
            }));
            
            // İndirme tamamlandı bildirimi gönder (gönderici tarafa bildirim)
            await notifyDownloadComplete(fileId, sessionId, senderId);
            
            // Tüm parçaları birleştir
            const mergedFile = new Blob(chunks, { type: "application/octet-stream" });
            
            // Sunucu oturumunu temizle
            await serverRelay.cleanupSession();
            
            // Tamamlanan dosyayı döndür
            return mergedFile;
        } catch (error) {
            console.error("[Dosya İndirme] Sunucudan indirme işlemi hatası:", error);
            message.error(`${fileName} indirilemedi: ${error}`);
            
            // İndirme durumunu hata olarak işaretle
            setDownloads(prev => {
                return {
                    ...prev,
                    [fileId]: {
                        ...prev[fileId],
                        error: true,
                        stopped: true
                    }
                };
            });
            
            // Sunucu oturumunu temizlemeyi dene
            try {
                const serverRelayModule = await import('./helpers/server-relay');
                await serverRelayModule.default.cleanupSession();
            } catch (cleanupError) {
                console.error("Oturum temizlenirken hata:", cleanupError);
            }
            
            return null;
        }
    };
    
    // İndirmenin durdurulup durdurulmadığını kontrol eden fonksiyon
    const isDownloadStopped = (fileId: string): boolean => {
        const download = downloads[fileId];
        return !download || download.stopped || download.complete;
    };
    
    // P2P aktarımı için bağlantı kontrolü ve hata yönetimi
    useEffect(() => {
        const p2pUploads = Object.entries(uploads).filter(
            ([fileId, upload]) => upload.transferType === 'p2p' && !upload.complete && !upload.stopped
        );
        
        const p2pDownloads = Object.entries(downloads).filter(
            ([fileId, download]) => download.transferType === 'p2p' && !download.complete && !download.stopped
        );
        
        // Aktif P2P transferleri varsa bağlantı kontrolünü başlat
        if ((p2pUploads.length > 0 || p2pDownloads.length > 0) && connection.selectedId) {
            const checkP2PConnection = async () => {
                try {
                    // Karşı tarafa ping gönder
                    await PeerConnection.sendConnection(connection.selectedId!, {
                        dataType: DataType.PING,
                        message: "p2p_ping",
                        peerId: peer.id || ''
                    });
                } catch (err) {
                    console.log("P2P bağlantısı koptu");
                    
                    // Yüklemeleri durumu güncelle
                    if (p2pUploads.length > 0) {
                        setUploads(prev => {
                            const newUploads = { ...prev };
                            Object.keys(newUploads).forEach(key => {
                                if (newUploads[key].transferType === 'p2p' && !newUploads[key].complete && !newUploads[key].stopped) {
                                    newUploads[key] = {
                                        ...newUploads[key],
                                        stopped: true,
                                        error: true
                                    };
                                }
                            });
                            return newUploads;
                        });
                        
                        // Kullanıcıya bildir
                        message.error("P2P bağlantısı koptu. Dosya gönderimi durduruldu.");
                    }
                    
                    // İndirmeleri güncelle
                    if (p2pDownloads.length > 0) {
                        setDownloads(prev => {
                            const newDownloads = { ...prev };
                            Object.keys(newDownloads).forEach(key => {
                                if (newDownloads[key].transferType === 'p2p' && !newDownloads[key].complete && !newDownloads[key].stopped) {
                                    newDownloads[key] = {
                                        ...newDownloads[key],
                                        stopped: true,
                                        error: true
                                    };
                                }
                            });
                            return newDownloads;
                        });
                        
                        // Kullanıcıya bildir
                        message.error("P2P bağlantısı koptu. Dosya indirimi durduruldu.");
                    }
                }
            };
            
            // 5 saniyede bir bağlantı kontrolü yap
            const p2pPingInterval = setInterval(checkP2PConnection, 5000);
            
            return () => {
                clearInterval(p2pPingInterval);
            };
        }
    }, [uploads, downloads, connection.selectedId, peer.id]);

    // P2P indirme/yükleme tamamlanma dinleyicisi
    useEffect(() => {
        // Aktif P2P yüklemeler varsa ve bir alıcıdan bildirim gelmişse
        if (connection.selectedId && peer.started) {
            const handleP2PDownloadComplete = (data: Data) => {
                // P2P indirme tamamlandı bildirimini kontrol et
                if (data.dataType === DataType.FILE && data.message === "P2P_DOWNLOAD_COMPLETE" && data.fileId) {
                    const fileId = data.fileId;
                    const fileName = data.fileName || "bilinmeyen dosya";
                    const remotePeerId = data.peerId || '';
                    
                    console.log(`Alıcı (${remotePeerId}) P2P dosya indirme tamamlandı bildirimi gönderdi: ${fileId}`);
                    
                    // Yüklemeyi tam olarak tamamlandı olarak işaretle
                    setUploads(prev => {
                        // P2P modunda fileId yeterli
                        const upload = prev[fileId];
                        if (upload && upload.transferType === 'p2p' && !upload.stopped) {
                            return {
                                ...prev,
                                [fileId]: {
                                    ...upload,
                                    progress: 100, // %100'e getir
                                    complete: true // Tamamlandı olarak işaretle
                                }
                            };
                        }
                        return prev;
                    });
                    
                    // Hız sıfırla
                    setUploadSpeed(prev => ({
                        ...prev,
                        [fileId]: 0
                    }));
                    
                    // İndirme tamamlanma mesajı göster
                    message.success(`${fileName} dosyası alıcı tarafından başarıyla indirildi`);
                }
            };
            
            // P2P indirme tamamlandı bildirim dinleyicisi ekle
            try {
                if (connection.selectedId) {
                    PeerConnection.onConnectionReceiveData(connection.selectedId, handleP2PDownloadComplete);
                }
            } catch (error) {
                console.error("P2P tamamlanma dinleyicisi eklenirken hata:", error);
            }
            
            return () => {
                // Dinleyiciyi temizle
                if (connection.selectedId) {
                    try {
                        PeerConnection.clearDataListeners(connection.selectedId);
                    } catch (error) {
                        console.error("P2P tamamlanma dinleyicisi kaldırılırken hata:", error);
                    }
                }
            };
        }
    }, [connection.selectedId, peer.started]);

    // Bağlantı ping-pong yanıtları için genel dinleyici
    useEffect(() => {
        if (connection.selectedId && peer.started) {
            try {
                // PING mesajlarını dinle ve PONG yanıtı ver
                PeerConnection.onConnectionReceiveData(connection.selectedId, (data: Data) => {
                    if (data.dataType === DataType.PING) {
                        try {
                            // Ping mesajı alındığında yanıt ver
                            if (data.message === "ping" && data.peerId) {
                                console.log(`Ping alındı, ${data.peerId}'e pong gönderiliyor`);
                                PeerConnection.sendConnection(data.peerId, {
                                    dataType: DataType.PING,
                                    message: "pong",
                                    peerId: peer.id || ''
                                });
                            }
                        } catch (err) {
                            console.error("Ping yanıtı gönderilirken hata:", err);
                        }
                    }
                });
            } catch (err) {
                console.error("Ping dinleyicisi eklenirken hata:", err);
            }
        }
        
        return () => {
            if (connection.selectedId) {
                try {
                    // Özellikle bu dinleyiciyi temizlemeye gerek yok, sayfa değiştiğinde zaten temizlenecek
                } catch (err) {
                    console.error("Dinleyici temizlenirken hata:", err);
                }
            }
        };
    }, [connection.selectedId, peer.id, peer.started]);

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Header style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '0 24px',
                background: isDarkMode ? '#1f1f1f' : '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                zIndex: 1
            }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <ApartmentOutlined style={{ fontSize: '24px', marginRight: '12px', color: '#1677ff' }} />
                    <Title level={3} style={{ margin: 0, color: isDarkMode ? '#fff' : '#000' }}>P2P Dosya Transferi</Title>
                </div>
                <div>
                    <Tooltip title={isDarkMode ? "Aydınlık Tema" : "Karanlık Tema"}>
                        <Switch 
                            checkedChildren={<BulbOutlined />} 
                            unCheckedChildren={<BulbOutlined />}
                            checked={isDarkMode}
                            onChange={toggleTheme}
                            style={{ marginRight: '16px' }}
                        />
                    </Tooltip>
                </div>
            </Header>
            <Content style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                <Row gutter={[24, 24]}>
                    <Col xs={24} lg={peer.started ? 12 : 24}>
                        <Card 
                            title={
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <UserOutlined style={{ marginRight: '8px' }} />
                                    <span>Kullanıcı Bilgileri</span>
                                </div>
                            }
                            bordered={false}
                            style={{ 
                                height: '100%', 
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                            }}
                        >
                            {!peer.started ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' }}>
                                    <Avatar size={64} icon={<UserOutlined />} style={{ marginBottom: '16px', backgroundColor: '#1677ff' }} />
                                    <Text style={{ marginBottom: '24px' }}>P2P bağlantısını başlatmak için butona tıklayın</Text>
                                    <Button 
                                        type="primary" 
                                        size="large"
                                        onClick={handleStartSession} 
                                        loading={peer.loading}
                                        icon={<ApartmentOutlined />}
                                        style={{ borderRadius: '6px' }}
                                    >
                                        Bağlantıyı Başlat
                                    </Button>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'space-between',
                                        padding: '16px',
                                        backgroundColor: isDarkMode ? '#141414' : '#f0f5ff',
                                        borderRadius: '8px',
                                        marginBottom: '16px'
                                    }}>
                                        <div>
                                            <Text type="secondary">Kullanıcı ID</Text>
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                marginTop: '4px'
                                            }}>
                                                <Badge status="success" />
                                                <Text strong style={{ marginLeft: '8px' }}>{peer.id}</Text>
                                            </div>
                                        </div>
                                        <Space>
                                            <Tooltip title="ID'yi Kopyala">
                                                <Button 
                                                    icon={<CopyOutlined />} 
                                                    onClick={async () => {
                                                        await navigator.clipboard.writeText(peer.id || "");
                                                        message.success("Kopyalandı: " + peer.id);
                                                    }}
                                                />
                                            </Tooltip>
                                            <Tooltip title="Bağlantıyı Sonlandır">
                                                <Button 
                                                    danger 
                                                    icon={<DisconnectOutlined />}
                                                    onClick={handleStopSession}
                                                />
                                            </Tooltip>
                                        </Space>
                                    </div>
                                    
                                    <Divider orientation="left">Bağlantı Oluştur</Divider>
                                    
                                    <div style={{ marginBottom: '16px' }}>
                                        <Input.Group compact>
                                            <Input
                                                style={{ width: 'calc(100% - 120px)' }}
                                                placeholder="Bağlanılacak ID"
                                                onChange={e => dispatch(connectionAction.changeConnectionInput(e.target.value))}
                                                prefix={<LinkOutlined />}
                                            />
                                            <Button
                                                type="primary"
                                                icon={<ApartmentOutlined />}
                                                loading={connection.loading}
                                                onClick={handleConnectOtherPeer}
                                                style={{ width: '120px' }}
                                            >
                                                Bağlan
                                            </Button>
                                        </Input.Group>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </Col>

                    {peer.started && (
                        <Col xs={24} lg={12}>
                            <Card 
                                title={
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <ApartmentOutlined style={{ marginRight: '8px' }} />
                                        <span>Bağlantılar</span>
                                    </div>
                                }
                                bordered={false}
                                style={{ 
                                    marginBottom: '24px', 
                                    borderRadius: '12px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                                }}
                            >
                                {connection.list.length === 0 ? (
                                    <div style={{ 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        alignItems: 'center',
                                        padding: '32px 0'
                                    }}>
                                        <ApartmentOutlined style={{ fontSize: '32px', marginBottom: '16px', color: '#d9d9d9' }} />
                                        <Text type="secondary">Bağlantı bekleniyor...</Text>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <Text type="secondary">
                                                {multiSendMode ? "Göndermek istediğiniz alıcıları seçin" : "Bir bağlantı seçin"}
                                        </Text>
                                            <Tooltip title={multiSendMode ? "Çoklu Gönderim Açık" : "Çoklu Gönderim"}>
                                                <Switch 
                                                    checkedChildren={<ApartmentOutlined />} 
                                                    unCheckedChildren={<SendOutlined />}
                                                    checked={multiSendMode}
                                                    onChange={(checked) => {
                                                        setMultiSendMode(checked);
                                                        // Mod değiştiğinde seçimleri sıfırla
                                                        if (checked) {
                                                            setSelectedReceivers([]);
                                                        } else {
                                                            if (connection.selectedId) {
                                                                setSelectedReceivers([connection.selectedId]);
                                                            } else {
                                                                setSelectedReceivers([]);
                                                            }
                                                        }
                                                    }}
                                                />
                                            </Tooltip>
                                        </div>
                                        
                                        <div style={{ marginBottom: '10px' }}>
                                            {multiSendMode && (
                                                <div style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    padding: '8px 12px',
                                                    margin: '0 0 8px 0',
                                                    backgroundColor: isDarkMode ? '#141414' : '#f5f5f5',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer'
                                                }} 
                                                onClick={() => {
                                                    if (selectedReceivers.length === connection.list.length) {
                                                        // Tümü seçiliyse, hiçbirini seçme
                                                        setSelectedReceivers([]);
                                                    } else {
                                                        // Tümünü seç
                                                        setSelectedReceivers(connection.list);
                                                    }
                                                }}>
                                                    <Checkbox 
                                                        checked={selectedReceivers.length === connection.list.length && connection.list.length > 0}
                                                        indeterminate={selectedReceivers.length > 0 && selectedReceivers.length < connection.list.length}
                                                        style={{ marginRight: '8px' }}
                                                    />
                                                    <Text style={{ 
                                                        color: isDarkMode ? '#d9d9d9' : undefined
                                                    }}>
                                                        {selectedReceivers.length === 0 ? "Tümünü Seç" : 
                                                         selectedReceivers.length === connection.list.length ? "Tümünü Kaldır" : 
                                                         `${selectedReceivers.length} / ${connection.list.length} Seçildi`}
                                                    </Text>
                                                </div>
                                            )}
                                        
                                        <Menu
                                                style={{ 
                                                    borderRadius: '8px',
                                                    backgroundColor: isDarkMode ? '#141414' : 'transparent',
                                                    border: isDarkMode ? '1px solid #303030' : undefined,
                                                }}
                                                selectedKeys={multiSendMode ? selectedReceivers : connection.selectedId ? [connection.selectedId] : []}
                                                multiple={multiSendMode}
                                                onClick={(info) => {
                                                    // Tıklanan ID
                                                    const clickedId = info.key;
                                                    
                                                    if (multiSendMode) {
                                                        // Çoklu modda, seçili ise kaldır, değilse ekle
                                                        if (selectedReceivers.includes(clickedId)) {
                                                            setSelectedReceivers(prev => prev.filter(id => id !== clickedId));
                                                        } else {
                                                            setSelectedReceivers(prev => [...prev, clickedId]);
                                                        }
                                                    } else {
                                                        // Tekli modda, zaten seçili ise kaldır, değilse seç
                                                        if (connection.selectedId === clickedId) {
                                                            dispatch(connectionAction.selectItem(''));
                                                        } else {
                                                            dispatch(connectionAction.selectItem(clickedId));
                                                        }
                                                    }
                                                }}
                                            items={connection.list.map(e => getItem(
                                                    <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                        {multiSendMode && (
                                                            <Checkbox 
                                                                checked={selectedReceivers.includes(e)} 
                                                                style={{ marginRight: '8px' }}
                                                                onClick={(event) => {
                                                                    event.stopPropagation(); // Menu tıklamasını engelle
                                                                    
                                                                    // ID'ye tıklamakla aynı mantık
                                                                    if (selectedReceivers.includes(e)) {
                                                                        setSelectedReceivers(prev => prev.filter(id => id !== e));
                                                                    } else {
                                                                        setSelectedReceivers(prev => [...prev, e]);
                                                                    }
                                                                }}
                                                            />
                                                        )}
                                                    <Badge status="processing" style={{ marginRight: '8px' }} />
                                                        <span style={{ 
                                                            color: isDarkMode ? 
                                                                (multiSendMode ? (selectedReceivers.includes(e) ? '#1890ff' : '#d9d9d9') : undefined)
                                                                : undefined
                                                        }}>{e}</span>
                                                        {multiSendMode && (
                                                            <Tooltip title="ID'yi Kopyala" placement="right">
                                                                <Button 
                                                                    type="text" 
                                                                    size="small" 
                                                                    icon={<CopyOutlined />} 
                                                                    onClick={(evt) => {
                                                                        evt.stopPropagation();
                                                                        navigator.clipboard.writeText(e);
                                                                        message.success("ID kopyalandı");
                                                                    }}
                                                                    style={{ marginLeft: 'auto' }}
                                                                />
                                                            </Tooltip>
                                                        )}
                                                </span>, 
                                                e, 
                                                null
                                            ))}
                                        />
                                        </div>
                                    </div>
                                )}
                            </Card>

                            <Card 
                                title={
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <FileOutlined style={{ marginRight: '8px' }} />
                                        <span>Dosya Gönder</span>
                                    </div>
                                }
                                bordered={false}
                                style={{ 
                                    height: 'calc(100% - 224px)', 
                                    borderRadius: '12px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                                }}
                            >
                                <div style={{ padding: '16px 0' }}>
                                    <Upload
                                        fileList={fileList}
                                        maxCount={10}
                                        multiple={true}
                                        onRemove={(file) => {
                                            const index = fileList.indexOf(file);
                                            const newFileList = [...fileList];
                                            newFileList.splice(index, 1);
                                            setFileList(newFileList);
                                        }}
                                        beforeUpload={(file, fileList) => {
                                            // Mevcut listedeki dosya isimleri
                                            const existingFileNames = fileList.map(f => f.name);
                                            
                                            // Ctrl ile toplu seçimde fileList içindeki tekrarları temizle
                                            const uniqueNewFilesMap = new Map();
                                            fileList.forEach(f => {
                                                if (!uniqueNewFilesMap.has(f.name)) {
                                                    uniqueNewFilesMap.set(f.name, f);
                                                }
                                            });
                                            
                                            const uniqueNewFiles = Array.from(uniqueNewFilesMap.values());
                                            
                                            // Mevcut fileList'teki dosyaları ekle (güncel durumu al)
                                            const currentFileNames = new Set(fileList.map(f => f.name));
                                            
                                            // Filtreleme işlemi yerine doğrudan ekleme yapalım
                                            if (uniqueNewFiles.length > 0) {
                                                setFileList((prevList: UploadFile[]) => {
                                                    // Önceki listede olmayanları filtrele
                                                    const actualNewFiles = uniqueNewFiles.filter(
                                                        f => !prevList.some(existing => existing.name === f.name)
                                                    );
                                                    
                                                    if (actualNewFiles.length === 0) {
                                                        message.info("Seçilen tüm dosyalar zaten listede mevcut.");
                                                        return prevList;
                                                    }
                                                    
                                                    if (actualNewFiles.length !== uniqueNewFiles.length) {
                                                        message.info(`${uniqueNewFiles.length - actualNewFiles.length} adet dosya zaten listede olduğu için tekrar eklenmedi.`);
                                                    }
                                                    
                                                    return [...prevList, ...actualNewFiles as unknown as UploadFile[]];
                                                });
                                            }
                                            return false;
                                        }}
                                        style={{ width: '100%' }}
                                    >
                                        <Button 
                                            icon={<UploadOutlined />} 
                                            style={{ 
                                                width: '100%', 
                                                height: '80px', 
                                                borderRadius: '8px', 
                                                borderStyle: 'dashed',
                                                borderColor: isDarkMode ? '#303030' : undefined,
                                                background: isDarkMode ? '#141414' : undefined,
                                                color: isDarkMode ? '#d9d9d9' : undefined
                                            }}
                                        >
                                            <div style={{ marginTop: '8px' }}>Çoklu Dosya Seçin</div>
                                        </Button>
                                    </Upload>
                                    
                                    {showServerRelayOption && (
                                        <div style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center',
                                            marginTop: '16px',
                                            marginBottom: '16px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <Switch 
                                                    checked={useServerRelay}
                                                    onChange={(checked) => {
                                                        setUseServerRelay(checked);
                                                        if (checked) {
                                                            // Sunucu bağlantısını kontrol et
                                                            message.loading({
                                                                content: 'Dokimor sunucusuna bağlanılıyor...',
                                                                key: 'serverConnection'
                                                            });
                                                            
                                                            import('./helpers/server-relay').then(async (api) => {
                                                                const isConnected = await api.default.checkServerConnection();
                                                                if (isConnected) {
                                                                    message.success({
                                                                        content: 'Dokimor sunucusuna bağlandı.',
                                                                        key: 'serverConnection'
                                                                    });
                                                                } else {
                                                                    message.error({
                                                                        content: 'Dokimor sunucusuna bağlanılamadı!',
                                                                        key: 'serverConnection'
                                                                    });
                                                                    setUseServerRelay(false);
                                                                }
                                                            }).catch(err => {
                                                                console.error('Sunucu modülü yüklenirken hata:', err);
                                                                message.error({
                                                                    content: 'Sunucu modülü yüklenemedi!',
                                                                    key: 'serverConnection'
                                                                });
                                                                setUseServerRelay(false);
                                                            });
                                                        }
                                                    }}
                                                    size="small"
                                                    style={{ marginRight: '8px' }}
                                                />
                                                <Text style={{ color: isDarkMode ? '#d9d9d9' : undefined }}>
                                                    Dokimor sunucuları üzerinden gönder
                                                </Text>
                                            </div>
                                            <Tooltip title={useServerRelay ? 
                                                "Bu seçenek aktif olduğunda dosyalar, Dokimor sunucuları üzerinden aktarılır. İnternet bağlantınız yavaşsa bu seçeneği kullanmanız önerilir." : 
                                                "Dokimor sunucuları üzerinden aktarım"
                                            }>
                                                <InfoCircleOutlined style={{ color: isDarkMode ? '#d9d9d9' : undefined }} />
                                            </Tooltip>
                                        </div>
                                    )}
                                    
                                    <Button
                                        type="primary"
                                        icon={<ApartmentOutlined />}
                                        onClick={handleUpload}
                                        disabled={fileList.length === 0 || (multiSendMode ? selectedReceivers.length === 0 : !connection.selectedId)}
                                        loading={sendLoading}
                                        style={{ marginTop: '16px', width: '100%', height: '40px', borderRadius: '6px' }}
                                    >
                                        {sendLoading ? 'Gönderiliyor...' : (multiSendMode ? `${selectedReceivers.length} Alıcıya Gönder` : 'Gönder')}
                                    </Button>
                                </div>
                            </Card>
                        </Col>
                    )}

                    {peer.started && (Object.keys(downloads).length > 0 || Object.keys(uploads).length > 0) && (
                        <Col xs={24}>
                            <Card 
                                title={
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <DownloadOutlined style={{ marginRight: '8px' }} />
                                        <span>Dosya Transfer Durumu</span>
                                    </div>
                                }
                                bordered={false}
                                style={{ 
                                    borderRadius: '12px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                                }}
                            >
                                {Object.keys(downloads).length > 0 && (
                                    <>
                                        <Divider orientation="left">İndirilen Dosyalar</Divider>
                                        {Object.entries(downloads).map(([fileId, download]) => (
                                            <div key={fileId} style={{ marginBottom: '24px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                    <Text strong>{download.fileName}</Text>
                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                        <Text type="secondary" style={{ marginRight: '16px' }}>
                                                            {(download.fileSize / (1024 * 1024)).toFixed(2)} MB
                                                        </Text>
                                                        {!download.complete && (
                                                            <Statistic 
                                                                value={formatSpeed(downloadSpeed[fileId] || 0)} 
                                                                valueStyle={{ fontSize: '14px', color: '#1677ff' }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <Progress 
                                                        percent={download.progress} 
                                                        status={download.complete ? "success" : download.stopped ? "exception" : "active"}
                                                        strokeColor={download.stopped ? "#ff4d4f" : {
                                                            '0%': '#108ee9',
                                                            '100%': '#87d068',
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                {formatSize(Math.floor(download.progress / 100 * download.fileSize))} / {formatSize(download.fileSize)}
                                                            </Text>
                                                            {download.transferType && (
                                                                <Badge 
                                                                    count={download.transferType === 'relay' ? 'Sunucu' : 'P2P'} 
                                                                    style={{ 
                                                                        marginLeft: '8px',
                                                                        backgroundColor: download.transferType === 'relay' ? '#faad14' : '#52c41a',
                                                                        fontSize: '10px'
                                                                    }} 
                                                                />
                                                            )}
                                                        </div>
                                                        {download.complete ? (
                                                            <Text type="success" style={{ fontSize: '12px' }}>Tamamlandı</Text>
                                                        ) : download.stopped ? (
                                                            <Text type="danger" style={{ fontSize: '12px' }}>Bağlantı Kesildi</Text>
                                                        ) : (
                                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                Kalan: {formatTimeRemaining(downloadSpeed[fileId] || 1, download.fileSize, download.progress)}
                                                            </Text>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}
                                
                                {Object.keys(uploads).length > 0 && (
                                    <>
                                        <Divider orientation="left">Gönderilen Dosyalar</Divider>
                                        {Object.entries(uploads).map(([fileId, upload]) => {
                                            // Çoklu gönderim durumunda dosya ID'sini ve alıcı ID'sini ayır
                                            let peerId = "bilinmiyor";
                                            let displayFileId = fileId;
                                            
                                            // fileId+peerId formatında olduğunu varsayalım
                                            if (fileId.length > 13) {
                                                const actualFileId = fileId.substring(0, 13); // İlk 13 karakter dosya ID'si
                                                peerId = fileId.substring(13); // Kalan kısım alıcı ID'si
                                                displayFileId = actualFileId;
                                            }
                                            
                                            return (
                                            <div key={fileId} style={{ marginBottom: '24px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                        <Text strong>
                                                            {upload.fileName}
                                                            <Text type="secondary" style={{ marginLeft: '8px', fontSize: '12px', wordBreak: 'break-all' }}>
                                                                (Alıcı: {peerId})
                                                            </Text>
                                                        </Text>
                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                        <Text type="secondary" style={{ marginRight: '16px' }}>
                                                            {(upload.fileSize / (1024 * 1024)).toFixed(2)} MB
                                                        </Text>
                                                        {!upload.complete && (
                                                            <Statistic 
                                                                value={formatSpeed(uploadSpeed[fileId] || 0)} 
                                                                valueStyle={{ fontSize: '14px', color: '#1677ff' }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <Progress 
                                                        percent={upload.progress} 
                                                        status={upload.complete ? "success" : upload.stopped ? "exception" : "active"}
                                                        strokeColor={upload.stopped ? "#ff4d4f" : {
                                                            '0%': '#108ee9',
                                                            '100%': '#87d068',
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                {formatSize(Math.floor(upload.progress / 100 * upload.fileSize))} / {formatSize(upload.fileSize)}
                                                            </Text>
                                                            {upload.transferType && (
                                                                <Badge 
                                                                    count={upload.transferType === 'relay' ? 'Sunucu' : 'P2P'} 
                                                                    style={{ 
                                                                        marginLeft: '8px',
                                                                        backgroundColor: upload.transferType === 'relay' ? '#faad14' : '#52c41a',
                                                                        fontSize: '10px'
                                                                    }} 
                                                                />
                                                            )}
                                                        </div>
                                                        {upload.complete ? (
                                                            <Text type="success" style={{ fontSize: '12px' }}>Tamamlandı</Text>
                                                        ) : upload.stopped ? (
                                                            <Text type="danger" style={{ fontSize: '12px' }}>Bağlantı Kesildi</Text>
                                                        ) : (
                                                            <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                Kalan: {formatTimeRemaining(uploadSpeed[fileId] || 1, upload.fileSize, upload.progress)}
                                                            </Text>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </>
                                )}
                            </Card>
                        </Col>
                    )}
                </Row>
            </Content>
            <Footer style={{ textAlign: 'center', background: 'transparent' }}>
                <Text type="secondary">P2P Dosya Transferi &copy; {new Date().getFullYear()}</Text>
            </Footer>
        </Layout>
    );
}
