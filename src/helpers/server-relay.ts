// P2P dosya transferi için Server Relay API
// Doğrudan bağlantı olmadığında sunucu üzerinden aktarım yapar

export interface RelaySessionInfo {
    sessionId: string;
    storageUsed: number;
    storageLimit: number;
    createdAt: Date;
}

export interface RelayFileInfo {
    fileId: string;
    fileName: string;
    fileSize: number;
    totalChunks: number;
    uploadedChunks: number[];
    downloadedChunks: { [peerId: string]: number[] };
}

export class ServerRelayAPI {
    private static instance: ServerRelayAPI;
    private sessionInfo: RelaySessionInfo | null = null;
    private files: Map<string, RelayFileInfo> = new Map();
    private baseUrl = 'http://localhost:3101/relay';
    private currentSessionId = '';
    private peerId = '';
    
    // Hız sınırlama için değişkenler
    private UPLOAD_RATE_LIMIT = 2 * 1024 * 1024; // 2MB/saniye
    private DOWNLOAD_RATE_LIMIT = 2 * 1024 * 1024; // 2MB/saniye
    private lastUploadTimestamp = Date.now();
    private lastDownloadTimestamp = Date.now();
    private bytesUploadedInWindow = 0;
    private bytesDownloadedInWindow = 0;
    private uploadQueue: (() => Promise<any>)[] = [];
    private downloadQueue: (() => Promise<any>)[] = [];
    private processingUploadQueue = false;
    private processingDownloadQueue = false;
    
    // Hız sınırlama için daha gelişmiş veri yapısı
    private uploadTransferLog: {time: number, bytes: number}[] = [];
    private downloadTransferLog: {time: number, bytes: number}[] = [];
    
    // Aktif yüklemekte olan chunk'ları takip etmek için
    private activeUploads = 0;
    private activeDownloads = 0;
    private maxConcurrentUploads = 3;
    private maxConcurrentDownloads = 3;
    
    // Tüm yükleme ve indirme işlemlerini iptal etmek için 
    private abortController: AbortController = new AbortController();
    
    // İptal işaretini kontrol et
    private isAborted(): boolean {
        return this.abortController.signal.aborted;
    }
    
    // İşlemleri iptal et
    public abortAllOperations(): void {
        console.log('[SERVER-RELAY] Tüm işlemler iptal ediliyor');
        
        // Kuyrukları temizle
        this.uploadQueue = [];
        this.downloadQueue = [];
        
        // İşlem bayrakları sıfırla
        this.processingUploadQueue = false;
        this.processingDownloadQueue = false;
        
        // AbortController iptal et
        this.abortController.abort();
        
        // Yeni bir AbortController oluştur (gelecekteki işlemler için)
        this.abortController = new AbortController();
        
        console.log('[SERVER-RELAY] İptal işlemi tamamlandı');
    }
    
    private constructor() {
        console.log("ServerRelayAPI başlatıldı");
    }
    
    /**
     * API istekleri için yardımcı metod, hata yönetimi yapar
     */
    private async apiRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            
            const options: RequestInit = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
            };
            
            if (body) {
                options.body = JSON.stringify(body);
            }
            
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API hatası (${response.status}): ${errorText}`);
            }
            
            // Yanıt JSON değilse (örneğin dosya indirme) Blob olarak döndür
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.blob();
            }
        } catch (error) {
            console.error('API isteği başarısız:', error);
            throw error;
        }
    }
    
    /**
     * Singleton API örneğini döndürür
     */
    public static getInstance(): ServerRelayAPI {
        if (!ServerRelayAPI.instance) {
            ServerRelayAPI.instance = new ServerRelayAPI();
        }
        return ServerRelayAPI.instance;
    }
    
    /**
     * Oturum başlatma
     * @param peerId Peer kimliği
     */
    public async startSession(peerId: string): Promise<RelaySessionInfo> {
        try {
            // Eski oturum varsa önce temizle
            if (this.sessionInfo && this.currentSessionId) {
                await this.cleanupSession();
            }
            
            // API'ye istek gönder
            const response = await this.apiRequest('/session/start', 'POST', { peerId });
            
            // Yeni oturum bilgilerini kaydet
            this.sessionInfo = {
                sessionId: response.sessionId,
                storageUsed: response.storageUsed,
                storageLimit: response.storageLimit,
                createdAt: new Date(response.createdAt)
            };
            
            this.currentSessionId = this.sessionInfo.sessionId;
            this.files = new Map(); // Dosya listesini temizle
            
            console.log("Sunucu aktarım oturumu başlatıldı:", this.sessionInfo.sessionId);
            return this.sessionInfo;
        } catch (error) {
            console.error("Oturum başlatılamadı:", error);
            throw error;
        }
    }
    
    /**
     * Oturum bilgisi alma
     */
    public getSessionInfo(): RelaySessionInfo | null {
        return this.sessionInfo;
    }
    
    /**
     * Sunucu oturumunu temizle
     */
    public async cleanupSession(): Promise<boolean> {
        if (!this.currentSessionId) {
            console.log("[SERVER-RELAY] Temizlenecek aktif oturum yok");
            return true; // Zaten aktif oturum yok
        }
        
        console.log("[SERVER-RELAY] Oturum temizleme başlatılıyor...");
        
        // Önce mutlaka tüm aktif işlemleri iptal et
        this.abortAllOperations();
        
        // Oturum ID'sini geçici olarak tut
        const sessionIdToCleanup = this.currentSessionId;
        
        // Hemen oturum bilgilerini temizle ki yeni işlemler başlamasın
        this.currentSessionId = '';
        this.sessionInfo = null;
        this.files.clear();
        
        try {
            // API isteğini gönder
            const result = await this.apiRequest('/cleanup', 'POST', { 
                sessionId: sessionIdToCleanup 
            });
            
            console.log("[SERVER-RELAY] Oturum temizleme API isteği başarılı");
            return result.success;
        } catch (error) {
            console.error("[SERVER-RELAY] Oturum temizleme API hatası:", error);
            return false;
        } finally {
            // Her durumda yerel durumu temizlendiğinden emin ol
            this.uploadQueue = [];
            this.downloadQueue = [];
            this.processingUploadQueue = false;
            this.processingDownloadQueue = false;
            console.log("[SERVER-RELAY] Oturum temizleme tamamlandı");
        }
    }
    
    /**
     * Dosya kaydı oluşturma
     */
    public async registerFile(fileInfo: {
        fileId: string;
        fileName: string;
        fileSize: number;
        totalChunks: number;
    }): Promise<boolean> {
        if (!this.validateSession()) return false;
        
        try {
            // API isteğini gönder
            await this.apiRequest('/file/register', 'POST', {
                ...fileInfo,
                sessionId: this.currentSessionId
            });
            
            // Dosya bilgilerini kaydet
            this.files.set(fileInfo.fileId, {
                ...fileInfo,
                uploadedChunks: [],
                downloadedChunks: {}
            });
            
            return true;
        } catch (error) {
            console.error("Dosya kaydedilirken hata:", error);
            return false;
        }
    }
    
    /**
     * Yükleme hız sınırlaması ekle
     */
    private async enforceUploadRateLimit(bytes: number): Promise<void> {
        const now = Date.now();
        
        // Son 5 saniyeye ait logları tut
        this.uploadTransferLog.push({
            time: now,
            bytes: bytes
        });
        
        // 5 saniyeden eski logları temizle
        this.uploadTransferLog = this.uploadTransferLog.filter(log => 
            (now - log.time) < 5000
        );
        
        // Son 1 saniyedeki toplam transfer hesabı
        const lastSecondTransfers = this.uploadTransferLog.filter(log => 
            (now - log.time) < 1000
        );
        
        // Son 1 saniyede transfer edilen toplam bayt sayısı
        const lastSecondBytes = lastSecondTransfers.reduce((total, log) => total + log.bytes, 0);
        
        // Anlık hızı hesapla (son 1 saniyede)
        const currentRate = lastSecondBytes; // 1 saniyedeki bayt sayısı = B/s
        
        console.log(`[Yükleme Hızı] Anlık: ${Math.round(currentRate/1024/1024*100)/100}MB/s, Limit: ${Math.round(this.UPLOAD_RATE_LIMIT/1024/1024*100)/100}MB/s`);
        
        // Limit aşıldı mı kontrol et
        if (currentRate >= this.UPLOAD_RATE_LIMIT) {
            const exceededBytes = currentRate - this.UPLOAD_RATE_LIMIT;
            
            // Hız limiti aşma oranına göre bekleme süresi belirle (aşma ne kadar büyükse o kadar uzun bekle)
            // Maximum bekleme süresi 1000ms (1 saniye) olacak şekilde sınırla
            const waitTime = Math.min(Math.ceil((exceededBytes / this.UPLOAD_RATE_LIMIT) * 1000), 1000);
            
            if (waitTime > 0) {
                console.log(`[UYARI] Yükleme hız sınırı aşıldı. Aşım: ${Math.round(exceededBytes/1024/1024*100)/100}MB/s, Bekleme: ${waitTime}ms`);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    /**
     * İndirme hız sınırlaması ekle
     */
    private async enforceDownloadRateLimit(bytes: number): Promise<void> {
        const now = Date.now();
        
        // Son 5 saniyeye ait logları tut
        this.downloadTransferLog.push({
            time: now,
            bytes: bytes
        });
        
        // 5 saniyeden eski logları temizle
        this.downloadTransferLog = this.downloadTransferLog.filter(log => 
            (now - log.time) < 5000
        );
        
        // Son 1 saniyedeki toplam transfer hesabı
        const lastSecondTransfers = this.downloadTransferLog.filter(log => 
            (now - log.time) < 1000
        );
        
        // Son 1 saniyede transfer edilen toplam bayt sayısı
        const lastSecondBytes = lastSecondTransfers.reduce((total, log) => total + log.bytes, 0);
        
        // Anlık hızı hesapla (son 1 saniyede)
        const currentRate = lastSecondBytes; // 1 saniyedeki bayt sayısı = B/s
        
        console.log(`[İndirme Hızı] Anlık: ${Math.round(currentRate/1024/1024*100)/100}MB/s, Limit: ${Math.round(this.DOWNLOAD_RATE_LIMIT/1024/1024*100)/100}MB/s`);
        
        // Limit aşıldı mı kontrol et
        if (currentRate >= this.DOWNLOAD_RATE_LIMIT) {
            const exceededBytes = currentRate - this.DOWNLOAD_RATE_LIMIT;
            
            // Hız limiti aşma oranına göre bekleme süresi belirle (aşma ne kadar büyükse o kadar uzun bekle)
            // Maximum bekleme süresi 1000ms (1 saniye) olacak şekilde sınırla
            const waitTime = Math.min(Math.ceil((exceededBytes / this.DOWNLOAD_RATE_LIMIT) * 1000), 1000);
            
            if (waitTime > 0) {
                console.log(`[UYARI] İndirme hız sınırı aşıldı. Aşım: ${Math.round(exceededBytes/1024/1024*100)/100}MB/s, Bekleme: ${waitTime}ms`);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    /**
     * Yükleme kuyruğuna işlev ekler ve sırasıyla çalıştırır
     */
    private async addToUploadQueue(taskFn: () => Promise<any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    const result = await taskFn();
                    resolve(result);
                    return result;
                } catch (error) {
                    reject(error);
                    throw error;
                }
            };
            
            this.uploadQueue.push(wrappedTask);
            this.processUploadQueue();
        });
    }
    
    /**
     * Yükleme kuyruğundaki işlevleri sırayla işler
     */
    private async processUploadQueue(): Promise<void> {
        if (this.processingUploadQueue || this.uploadQueue.length === 0) return;
        
        this.processingUploadQueue = true;
        
        try {
            while (this.uploadQueue.length > 0) {
                const task = this.uploadQueue.shift();
                if (task) await task();
            }
        } finally {
            this.processingUploadQueue = false;
        }
    }
    
    /**
     * İndirme kuyruğuna işlev ekler ve sırasıyla çalıştırır
     */
    private async addToDownloadQueue(taskFn: () => Promise<any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    const result = await taskFn();
                    resolve(result);
                    return result;
                } catch (error) {
                    reject(error);
                    throw error;
                }
            };
            
            this.downloadQueue.push(wrappedTask);
            this.processDownloadQueue();
        });
    }
    
    /**
     * İndirme kuyruğundaki işlevleri sırayla işler
     */
    private async processDownloadQueue(): Promise<void> {
        if (this.processingDownloadQueue || this.downloadQueue.length === 0) return;
        
        this.processingDownloadQueue = true;
        
        try {
            while (this.downloadQueue.length > 0) {
                const task = this.downloadQueue.shift();
                if (task) await task();
            }
        } finally {
            this.processingDownloadQueue = false;
        }
    }
    
    /**
     * Parça yükleme (hız sınırlamalı)
     */
    public async uploadChunk(fileId: string, chunkIndex: number, chunkData: Blob): Promise<boolean> {
        if (!this.currentSessionId || !fileId) {
            throw new Error("Geçerli bir oturum veya dosya ID'si yok");
        }
        
        // Her chunk'ı, düzgün hız kontrolü için bekletilen sıraya ekle
        return this.addToUploadQueue(async () => {
            try {
                // İptal edildi mi kontrol et
                if (this.isAborted()) {
                    console.log(`[SERVER-RELAY] Yükleme iptal edildi: ${fileId}, Parça: ${chunkIndex}`);
                    return false;
                }
                
                // Hız sınırlamasını kontrol et ve sınırla - chunk boyutu kadar veri yüklemeden önce kontrol
                await this.enforceUploadRateLimit(chunkData.size);
                
                // Tekrar iptal edildi mi kontrol et
                if (this.isAborted()) {
                    console.log(`[SERVER-RELAY] Hız kontrolü sonrası yükleme iptal edildi: ${fileId}, Parça: ${chunkIndex}`);
                    return false;
                }
                
                // Aktif yükleme sayısını takip et (paralel yükleme sayısını sınırlamak için)
                while (this.activeUploads >= this.maxConcurrentUploads) {
                    // İptal edildi mi kontrol et
                    if (this.isAborted()) {
                        console.log(`[SERVER-RELAY] Bekleme sırasında yükleme iptal edildi: ${fileId}, Parça: ${chunkIndex}`);
                        return false;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                this.activeUploads++;
                
                try {
                    const formData = new FormData();
                    formData.append('sessionId', this.currentSessionId);
                    formData.append('chunk', chunkData);
                    
                    console.log(`${fileId} için ${chunkIndex} numaralı parça yükleniyor (${chunkData.size} bytes)`);
                    
                    // İptal edildi mi son kez kontrol et
                    if (this.isAborted()) {
                        console.log(`[SERVER-RELAY] Fetch öncesi yükleme iptal edildi: ${fileId}, Parça: ${chunkIndex}`);
                        return false;
                    }
                    
                    const response = await fetch(`${this.baseUrl}/file/${fileId}/chunk/${chunkIndex}`, {
                        method: 'POST',
                        body: formData,
                        // Abortable fetch için signal ekle
                        signal: this.abortController.signal
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Parça yükleme hatası: ${errorText}`);
                    }
                    
                    const result = await response.json();
                    
                    // Dosya bilgisini güncelle
                    const fileInfo = this.files.get(fileId);
                    if (fileInfo) {
                        if (!fileInfo.uploadedChunks.includes(chunkIndex)) {
                            fileInfo.uploadedChunks.push(chunkIndex);
                        }
                    }
                    
                    return true;
                } finally {
                    // Aktif yükleme sayısını azalt
                    this.activeUploads--;
                }
            } catch (error) {
                console.error(`Parça yükleme hatası (${fileId}, Parça ${chunkIndex}):`, error);
                throw error;
            }
        });
    }
    
    /**
     * Parça indirme (hız sınırlamalı)
     */
    public async downloadChunk(fileId: string, chunkIndex: number, peerId: string): Promise<Blob> {
        if (!this.currentSessionId || !fileId) {
            throw new Error("Geçerli bir oturum veya dosya ID'si yok");
        }
        
        return this.addToDownloadQueue(async () => {
            try {
                console.log(`[İNDİRME] Parça indirme isteği gönderiliyor: ${fileId}, Parça: ${chunkIndex}, Oturum: ${this.currentSessionId}, Peer: ${peerId}`);
                
                // Maksimum deneme sayısını arttırdım ve daha kısa bekleme süresi ile başlıyoruz
                let maxRetries = 15;
                let retryCount = 0;
                let retryDelay = 200; // ms (daha kısa başlangıç gecikmesi)
                
                while (retryCount < maxRetries) {
                    try {
                        // Hata ayıklama için daha fazla bilgi ekle
                        const url = `${this.baseUrl}/file/${fileId}/chunk/${chunkIndex}?sessionId=${this.currentSessionId}&peerId=${peerId}&findAcrossSessions=true`;
                        console.log(`[İNDİRME] İstek URL: ${url}, Deneme: ${retryCount+1}`);
                        
                        // Her denemede (ilk denemeden itibaren) doğrudan indirmeyi dene
                        const response = await fetch(url, {
                            method: 'GET',
                            mode: 'cors',
                            credentials: 'omit',
                            headers: {
                                'Accept': 'application/octet-stream',
                                'Cache-Control': 'no-cache, no-store, must-revalidate'
                            }
                        });
                        
                        console.log(`[İNDİRME] Sunucu yanıt durumu: ${response.status} ${response.statusText}`);
                        
                        if (!response.ok) {
                            // Parça henüz yüklenmemiş, bekle ve tekrar dene
                            if (response.status === 404) {
                                const errorText = await response.text();
                                console.warn(`[İNDİRME] Parça hazır değil (${retryCount+1}/${maxRetries}): ${errorText}`);
                                
                                // Dosya durumunu sunucudan güncelleyelim
                                try {
                                    await this.syncFileStatus(fileId);
                                } catch (syncError) {
                                    console.error(`[İNDİRME] Dosya durumu senkronizasyon hatası:`, syncError);
                                }
                                
                                // Son deneme ise hata fırlat
                                if (retryCount >= maxRetries - 1) {
                                    throw new Error(`Parça indirme hatası: ${response.status} - Maksimum deneme sayısı aşıldı`);
                                }
                                
                                // Değilse bekle ve tekrar dene
                                retryCount++;
                                await new Promise(resolve => setTimeout(resolve, retryDelay));
                                retryDelay = Math.min(retryDelay * 1.2, 2000); // Daha yavaş artan bekleme süresi, maksimum 2 saniye
                                continue;
                            } else {
                                // Diğer hatalar için direkt hata fırlat
                                const errorText = await response.text();
                                console.error(`[İNDİRME HATA] Sunucu yanıt hatası: ${errorText}`);
                                throw new Error(`Parça indirme hatası: ${response.status} ${response.statusText} - ${errorText}`);
                            }
                        }
                        
                        // Content-Type kontrolü
                        const contentType = response.headers.get('Content-Type');
                        console.log(`[İNDİRME] İçerik türü: ${contentType}`);
                        
                        try {
                            const blob = await response.blob();
                            console.log(`[İNDİRME] Alınan blob boyutu: ${blob.size} bytes, Tip: ${blob.type}`);
                        
                            if (blob.size === 0) {
                                console.error(`[İNDİRME HATA] Boş veri alındı`);
                                throw new Error('Alınan parça verisi boş');
                            }
                        
                            // Hız sınırlamasını uygula
                            await this.enforceDownloadRateLimit(blob.size);
                        
                            // Dosya bilgisini güncelle
                            const fileInfo = this.files.get(fileId);
                            if (fileInfo) {
                                if (!fileInfo.downloadedChunks[peerId]) {
                                    fileInfo.downloadedChunks[peerId] = [];
                                }
                                
                                if (!fileInfo.downloadedChunks[peerId].includes(chunkIndex)) {
                                    fileInfo.downloadedChunks[peerId].push(chunkIndex);
                                }
                            }
                            
                            console.log(`[İNDİRME] Parça başarıyla alındı: ${fileId}, Parça: ${chunkIndex}, Boyut: ${blob.size} bytes`);
                            return blob;
                        } catch (blobError) {
                            console.error(`[İNDİRME HATA] Blob dönüştürme hatası:`, blobError);
                            throw blobError;
                        }
                    } catch (fetchError: any) {
                        // Son deneme değilse, bekle ve tekrar dene
                        if (retryCount < maxRetries - 1) {
                            console.warn(`[İNDİRME] Deneme başarısız (${retryCount+1}/${maxRetries}): ${fetchError.message}`);
                            retryCount++;
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            retryDelay = Math.min(retryDelay * 1.2, 2000); // Daha yavaş artan bekleme süresi
                            continue;
                        }
                        
                        // Son denemeyse hata fırlat
                        throw fetchError;
                    }
                }
                
                // Bu noktaya gelirse, maksimum deneme sayısı aşılmış demektir
                throw new Error(`Parça indirme hatası: Maksimum deneme sayısı (${maxRetries}) aşıldı`);
            } catch (error) {
                console.error(`[İNDİRME HATA] Parça indirme hatası (${fileId}, Parça ${chunkIndex}):`, error);
                throw error;
            }
        });
    }
    
    /**
     * Parça silme
     */
    public async deleteChunk(fileId: string, chunkIndex: number): Promise<boolean> {
        if (!this.sessionInfo) return false;
        
        try {
            // API isteğini gönder
            await this.apiRequest(`/file/${fileId}/chunk/${chunkIndex}`, 'DELETE', { 
                sessionId: this.currentSessionId 
            });
            
            // Yerel durumu güncelle
            const fileInfo = this.files.get(fileId);
            if (fileInfo) {
                const index = fileInfo.uploadedChunks.indexOf(chunkIndex);
                if (index > -1) {
                    fileInfo.uploadedChunks.splice(index, 1);
                }
            }
            
            return true;
        } catch (error) {
            console.error(`Parça silinirken hata: ${fileId}, Parça: ${chunkIndex}`, error);
            return false;
        }
    }
    
    /**
     * Sunucu bağlantı durumunu kontrol et
     */
    public async checkServerConnection(): Promise<boolean> {
        try {
            const response = await this.apiRequest('/status', 'GET');
            return response.status === 'online';
        } catch (error) {
            console.error("Sunucu bağlantı kontrolü başarısız:", error);
            return false;
        }
    }
    
    /**
     * Dosya yükleme durumunu kontrol et
     */
    public getFileUploadStatus(fileId: string): { 
        uploaded: number, 
        total: number,
        completed: boolean
    } {
        const fileInfo = this.files.get(fileId);
        if (!fileInfo) {
            return { uploaded: 0, total: 0, completed: false };
        }
        
        return {
            uploaded: fileInfo.uploadedChunks.length,
            total: fileInfo.totalChunks,
            completed: fileInfo.uploadedChunks.length === fileInfo.totalChunks
        };
    }
    
    /**
     * Dosya durumunu sunucudan al
     */
    public async getFileStatus(fileId: string): Promise<RelayFileInfo | null> {
        if (!this.validateSession()) return null;
        
        try {
            // API isteğini gönder
            const url = `${this.baseUrl}/file/${fileId}/status?sessionId=${this.currentSessionId}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Dosya durum bilgisi alınamadı (${response.status}): ${errorText}`);
            }
            
            const fileStatus = await response.json();
            
            // Sunucudan gelen bilgileri RelayFileInfo biçimine dönüştür
            return {
                fileId: fileId,
                fileName: fileStatus.fileName,
                fileSize: fileStatus.fileSize,
                totalChunks: fileStatus.totalChunks,
                uploadedChunks: fileStatus.uploadedChunks || [],
                downloadedChunks: fileStatus.downloadedChunks || {}
            };
        } catch (error) {
            console.error(`Dosya durum bilgisi alınırken hata: ${fileId}`, error);
            return null;
        }
    }
    
    /**
     * Dosya durumunu sunucudan senkronize et
     */
    public async syncFileStatus(fileId: string): Promise<boolean> {
        if (!this.validateSession()) return false;
        
        try {
            // API isteğini gönder
            const url = `${this.baseUrl}/file/${fileId}/status?sessionId=${this.currentSessionId}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Dosya durum senkronizasyon hatası (${response.status}): ${errorText}`);
            }
            
            const fileStatus = await response.json();
            
            // Dosya bilgilerini güncelle
            const fileInfo = this.files.get(fileId);
            if (fileInfo) {
                fileInfo.uploadedChunks = fileStatus.uploadedChunks;
                fileInfo.downloadedChunks = fileStatus.downloadedChunks;
            } else {
                // Eğer dosya yerel olarak tanımlı değilse, oluştur
                this.files.set(fileId, {
                    fileId: fileId,
                    fileName: fileStatus.fileName,
                    fileSize: fileStatus.fileSize,
                    totalChunks: fileStatus.totalChunks,
                    uploadedChunks: fileStatus.uploadedChunks,
                    downloadedChunks: fileStatus.downloadedChunks
                });
            }
            
            return true;
        } catch (error) {
            console.error(`Dosya durumu senkronize edilirken hata: ${fileId}`, error);
            return false;
        }
    }
    
    /**
     * Oturum doğrulama yardımcı metodu
     * @private
     */
    private validateSession(): boolean {
        if (!this.sessionInfo || !this.currentSessionId) {
            console.error("Aktif oturum yok, işlem gerçekleştirilemiyor");
            return false;
        }
        return true;
    }
}

export default ServerRelayAPI.getInstance();
