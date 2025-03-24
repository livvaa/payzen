import Peer, {DataConnection, PeerErrorType, PeerError} from "peerjs";
import {message} from "antd";
import * as CryptoJS from 'crypto-js';

export enum DataType {
    FILE = 'FILE',
    OTHER = 'OTHER',
    FILE_HASH = 'FILE_HASH', // Dosya hash değeri
    RELAY_FILE_INFO = 'RELAY_FILE_INFO', // Sunucu üzerinden aktarım için dosya bilgisi
    RELAY_CHUNK_INFO = 'RELAY_CHUNK_INFO', // Sunucu üzerinden aktarım için parça bilgisi
    RELAY_DOWNLOAD_READY = 'RELAY_DOWNLOAD_READY', // Sunucu üzerinden indirme hazır bildirimi
    PING = 'PING' // Bağlantı kontrolü için ping mesajı
}

export interface Data {
    dataType: DataType
    file?: Blob
    fileName?: string
    fileType?: string
    message?: string
    chunkIndex?: number
    totalChunks?: number
    chunkSize?: number
    fileId?: string
    fileSize?: number
    progress?: number
    fileHash?: string // Dosya hash değeri
    // Sunucu aktarımı için ek alanlar
    sessionId?: string // Sunucu oturum ID'si
    serverFileId?: string // Sunucu dosya ID'si
    peerId?: string // Gönderen tarafın peer ID'si
}

// Hash hesaplama fonksiyonu
export async function calculateFileHash(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            // Büyük dosyalar için parçalı işlem yapalım
            const hasher = new StreamHasher();
            
            // Dosyayı 2MB'lık parçalara bölerek işleyelim
            const HASH_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
            let offset = 0;
            
            const processNextChunk = async () => {
                try {
                    if (offset >= file.size) {
                        // Tüm parçalar işlendi, hash'i döndürelim
                        const finalHash = hasher.finalize();
                        resolve(finalHash);
                        return;
                    }
                    
                    const chunk = file.slice(offset, Math.min(offset + HASH_CHUNK_SIZE, file.size));
                    await hasher.addChunk(chunk);
                    
                    // Sonraki parçaya geç
                    offset += HASH_CHUNK_SIZE;
                    
                    // Asenkron olarak kendini tekrar çağır (call stack taşmasını önle)
                    setTimeout(processNextChunk, 0);
                } catch (error) {
                    console.error("Hash hesaplama hatası:", error);
                    reject(error);
                }
            };
            
            // İlk parçayı işlemeye başla
            processNextChunk();
        } catch (error) {
            console.error("Hash hesaplama başlatma hatası:", error);
            reject(error);
        }
    });
}

// Stream tabanlı hash hesaplama fonksiyonu
// Büyük dosyaları küçük parçalara bölerek parçaların hashlerini hesaplar ve final hash oluşturur
export class StreamHasher {
    private hashObj: CryptoJS.lib.WordArray;
    private isFinalized: boolean = false;
    
    constructor() {
        this.hashObj = CryptoJS.lib.WordArray.create();
    }
    
    // Dosya parçasını hash hesaplamasına ekle
    addChunk(chunk: Blob): Promise<void> {
        if (this.isFinalized) {
            return Promise.reject(new Error("Hash hesaplayıcı sonlandırıldı, daha fazla parça eklenemez"));
        }
        
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        // ArrayBuffer'ı doğrudan WordArray'e çevirmek hata verebilir
                        // Bunun yerine Uint8Array kullanarak dönüşüm yapalım
                        const arrayBuffer = reader.result as ArrayBuffer;
                        const uint8Array = new Uint8Array(arrayBuffer);
                        
                        // Uint8Array üzerinden manuel olarak WordArray oluşturalım
                        // Her bir byte'ı CryptoJS formatına çevirelim
                        const wordArray = CryptoJS.lib.WordArray.create();
                        
                        // Küçük parçalar halinde işleyelim (1MB'dan küçük parçalar)
                        const PROCESS_CHUNK_SIZE = 1024 * 1024; // 1MB
                        for (let i = 0; i < uint8Array.length; i += PROCESS_CHUNK_SIZE) {
                            const end = Math.min(i + PROCESS_CHUNK_SIZE, uint8Array.length);
                            const subArray = uint8Array.subarray(i, end);
                            
                            // Bu parçayı CryptoJS formatına çevirelim
                            const subWordArray = CryptoJS.lib.WordArray.create(subArray);
                            
                            // Ana hash nesnesine ekleyelim
                            this.hashObj = this.hashObj.concat(subWordArray);
                        }
                        
                        resolve();
                    } catch (error) {
                        console.error("Hash parçası hesaplama hatası:", error);
                        reject(error);
                    }
                };
                reader.onerror = () => {
                    reject(new Error("Parça okunamadı"));
                };
                reader.readAsArrayBuffer(chunk);
            } catch (error) {
                console.error("Stream hash hatası:", error);
                reject(error);
            }
        });
    }
    
    // Hesaplamayı sonlandır ve final hash'i döndür
    finalize(): string {
        this.isFinalized = true;
        return CryptoJS.SHA256(this.hashObj).toString();
    }
    
    // Hash oluşturucuyu sıfırla
    reset(): void {
        this.hashObj = CryptoJS.lib.WordArray.create();
        this.isFinalized = false;
    }
}

let peer: Peer | undefined
let connectionMap: Map<string, DataConnection> = new Map<string, DataConnection>()

// Parça boyutu ve aktarım parametreleri
const CHUNK_SIZE = 16384; // 16KB (daha büyük parçalar daha hızlı transfer)
const MAX_CONCURRENT_CHUNKS = 16; // Aynı anda 16 parça gönderebiliriz
const CHUNK_DELAY = 5; // ms (daha kısa gecikme daha hızlı aktarım)

export const PeerConnection = {
    getPeer: () => peer,
    startPeerSession: () => new Promise<string>((resolve, reject) => {
        try {
            peer = new Peer()
            peer.on('open', (id) => {
                console.log('My ID: ' + id)
                resolve(id)
            }).on('error', (err) => {
                console.log(err)
                message.error(err.message)
            })
        } catch (err) {
            console.log(err)
            reject(err)
        }
    }),
    closePeerSession: () => new Promise<void>((resolve, reject) => {
        try {
            if (peer) {
                peer.destroy()
                peer = undefined
            }
            resolve()
        } catch (err) {
            console.log(err)
            reject(err)
        }
    }),
    connectPeer: (id: string) => new Promise<void>((resolve, reject) => {
        if (!peer) {
            reject(new Error("Peer doesn't start yet"))
            return
        }
        if (connectionMap.has(id)) {
            reject(new Error("Connection existed"))
            return
        }
        try {
            let conn = peer.connect(id, {reliable: true})
            if (!conn) {
                reject(new Error("Connection can't be established"))
            } else {
                conn.on('open', function() {
                    console.log("Connect to: " + id)
                    connectionMap.set(id, conn)
                    peer?.removeListener('error', handlePeerError)
                    resolve()
                }).on('error', function(err) {
                    console.log(err)
                    peer?.removeListener('error', handlePeerError)
                    reject(err)
                })

                // When the connection fails due to expiry, the error gets emmitted
                // to the peer instead of to the connection.
                // We need to handle this here to be able to fulfill the Promise.
                const handlePeerError = (err: PeerError<`${PeerErrorType}`>) => {
                    if (err.type === 'peer-unavailable') {
                        const messageSplit = err.message.split(' ')
                        const peerId = messageSplit[messageSplit.length - 1]
                        if (id === peerId) reject(err)
                    }
                }
                peer.on('error', handlePeerError);
            }
        } catch (err) {
            reject(err)
        }
    }),
    onIncomingConnection: (callback: (conn: DataConnection) => void) => {
        peer?.on('connection', function (conn) {
            console.log("Incoming connection: " + conn.peer)
            connectionMap.set(conn.peer, conn)
            callback(conn)
        });
    },
    onConnectionDisconnected: (id: string, callback: () => void) => {
        if (!peer) {
            throw new Error("Peer doesn't start yet")
        }
        if (!connectionMap.has(id)) {
            throw new Error("Connection didn't exist")
        }
        let conn = connectionMap.get(id);
        if (conn) {
            conn.on('close', function () {
                console.log("Connection closed: " + id)
                connectionMap.delete(id)
                callback()
            });
        }
    },
    sendConnection: (id: string, data: Data, progressCallback?: (progress: number) => void): Promise<void> => new Promise(async (resolve, reject) => {
        if (!connectionMap.has(id)) {
            reject(new Error("Connection didn't exist"))
            return;
        }
        
        try {
            let conn = connectionMap.get(id);
            
            if (conn) {
                // Dosya gönderiyorsak parçalama işlemi yap
                if (data.dataType === DataType.FILE && data.file) {
                    console.log(`Dosya gönderimi başlıyor. Boyut: ${data.file.size} bytes`);
                    
                    const fileId = Math.random().toString(36).substring(2, 15);
                    const file = data.file;
                    const fileSize = file.size;
                    const fileName = data.fileName;
                    const fileType = data.fileType;
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    
                    console.log(`Toplam parça sayısı: ${totalChunks}, Parça boyutu: ${CHUNK_SIZE} bytes`);
                    
                    // Hash hesaplayıcıyı başlat
                    const hasher = new StreamHasher();
                    let hashPromises: Promise<void>[] = [];
                    
                    // Meta veri gönderimi (hash şimdilik boş, sonradan güncellenecek)
                    conn.send({
                        dataType: DataType.FILE,
                        fileName: fileName,
                        fileType: fileType,
                        fileId: fileId,
                        totalChunks: totalChunks,
                        fileSize: fileSize,
                        chunkIndex: -1, // -1, meta veri olduğunu belirtir
                        message: "META"
                    });
                    
                    // Dosyayı parçalara bölme ve gönderme
                    let chunksSent = 0;
                    let sendingComplete = false;
                    
                    // Paralel parça gönderimi için senkronizasyon mekanizması
                    const sendChunkBatch = async (startIndex: number) => {
                        const endIndex = Math.min(startIndex + MAX_CONCURRENT_CHUNKS, totalChunks);
                        const connection = connectionMap.get(id);
                        
                        if (!connection) {
                            reject(new Error("Connection lost"));
                            return;
                        }
                        
                        // Bu grup içindeki tüm parçaları paralel olarak gönder
                        const promises = [];
                        for (let i = startIndex; i < endIndex; i++) {
                            const start = i * CHUNK_SIZE;
                            const end = Math.min(file.size, start + CHUNK_SIZE);
                            const chunk = file.slice(start, end);
                            
                            // Hash hesaplama işlemini de paralel olarak yap
                            hashPromises.push(hasher.addChunk(chunk));
                            
                            promises.push(new Promise<void>((resolveChunk) => {
                                try {
                                    connection.send({
                                        dataType: DataType.FILE,
                                        file: chunk,
                                        fileId: fileId,
                                        chunkIndex: i,
                                        totalChunks: totalChunks,
                                        chunkSize: chunk.size
                                    });
                                    chunksSent++;
                                    
                                    // İlerleme durumunu bildir
                                    if (progressCallback) {
                                        const progress = Math.floor((chunksSent / totalChunks) * 100);
                                        progressCallback(progress);
                                    }
                                    
                                    resolveChunk();
                                } catch (err) {
                                    console.error(`Parça ${i} gönderilirken hata:`, err);
                                    resolveChunk(); // Hata olsa bile devam et
                                }
                            }));
                        }
                        
                        // Tüm parçaların gönderimini bekle
                        await Promise.all(promises);
                        
                        // Tüm parçalar gönderildiyse hash hesaplamasını tamamla ve gönder
                        if (endIndex >= totalChunks) {
                            console.log("Tüm parçalar gönderildi");
                            
                            // Tüm hash hesaplama promiselerinin tamamlanmasını bekle
                            await Promise.all(hashPromises);
                            
                            // Final hash'i hesapla
                            const fileHash = hasher.finalize();
                            console.log(`Dosya hash değeri (SHA-256): ${fileHash}`);
                            
                            // Hash değerini ayrı bir mesaj olarak gönder
                            const connection = connectionMap.get(id);
                            if (connection) {
                                connection.send({
                                    dataType: DataType.FILE_HASH,
                                    fileId: fileId,
                                    fileName: fileName,
                                    fileHash: fileHash,
                                    message: "HASH_VALUE"
                                });
                            } else {
                                console.error("Bağlantı kaybedildi, hash değeri gönderilemedi");
                            }
                            
                            if (progressCallback) progressCallback(100);
                            resolve();
                        } else {
                            // 5ms bekleyip bir sonraki grup parçaları gönder
                            setTimeout(() => {
                                sendChunkBatch(endIndex);
                            }, CHUNK_DELAY);
                        }
                    };
                    
                    // İlk grup parçaları göndermeye başla
                    sendChunkBatch(0);
                    
                } else {
                    // Dosya değilse normal gönder
                    conn.send(data);
                    resolve();
                }
            } else {
                reject(new Error("Connection not found"));
            }
        } catch (err) {
            console.error("Send error:", err);
            reject(err);
        }
    }),
    onConnectionReceiveData: (id: string, callback: (f: Data) => void) => {
        if (!peer) {
            throw new Error("Peer doesn't start yet")
        }
        if (!connectionMap.has(id)) {
            throw new Error("Connection didn't exist")
        }
        
        let conn = connectionMap.get(id);
        
        // Dosya parçalarını birleştirmek için gerekli veri yapıları
        const fileChunks = new Map<string, Map<number, Blob>>();
        const fileMetadata = new Map<string, {
            fileName: string,
            fileType: string,
            totalChunks: number,
            fileSize: number,
            receivedChunks: number,
            lastProgressUpdate: number,
            fileHash?: string, // Gönderici hash değeri
        }>();
        
        if (conn) {
            conn.on('data', function (receivedData) {
                try {
                    let data = receivedData as Data;
                    
                    // Dosya parçalarını işleme
                    if (data.dataType === DataType.FILE && data.fileId) {
                        // Meta veri
                        if (data.chunkIndex === -1) {
                            console.log(`Dosya indirme başlıyor: ${data.fileName}, Boyut: ${data.fileSize} bytes, Parça sayısı: ${data.totalChunks}`);
                            
                            fileMetadata.set(data.fileId, {
                                fileName: data.fileName || "untitled",
                                fileType: data.fileType || "application/octet-stream",
                                totalChunks: data.totalChunks || 0,
                                fileSize: data.fileSize || 0,
                                receivedChunks: 0,
                                lastProgressUpdate: Date.now()
                            });
                            fileChunks.set(data.fileId, new Map());
                            
                            // İndirme başlangıcını bildir
                            callback({
                                dataType: DataType.FILE,
                                fileId: data.fileId,
                                fileName: data.fileName,
                                fileType: data.fileType,
                                chunkIndex: 0,
                                totalChunks: data.totalChunks,
                                fileSize: data.fileSize,
                                message: "START_DOWNLOAD",
                                progress: 0
                            });
                        } 
                        // Dosya parçası
                        else if (data.file && data.chunkIndex !== undefined && fileChunks.has(data.fileId)) {
                            const chunksMap = fileChunks.get(data.fileId)!;
                            const meta = fileMetadata.get(data.fileId)!;
                            
                            // Her 100 parçada bir log yazdır (fazla log istemiyoruz)
                            if (data.chunkIndex % 100 === 0) {
                                console.log(`Dosya parçası alındı: ${data.fileId}, İndeks: ${data.chunkIndex}, Boyut: ${data.file.size} bytes`);
                            }
                            
                            // Parçayı kaydet
                            chunksMap.set(data.chunkIndex, data.file);
                            meta.receivedChunks++;
                            
                            // Her parça alımında ilerleme bildirimi yapmak yerine belirli aralıklarla yap
                            const now = Date.now();
                            // Yalnızca belirli aralıklarla (200ms) ilerleme bildirimi yapalım
                            if (now - meta.lastProgressUpdate >= 200 || meta.receivedChunks === meta.totalChunks) {
                                meta.lastProgressUpdate = now;
                                
                                // İlerleme durumunu bildir
                                const progress = Math.floor((meta.receivedChunks / meta.totalChunks) * 100);
                                callback({
                                    dataType: DataType.FILE,
                                    fileId: data.fileId,
                                    chunkIndex: data.chunkIndex,
                                    totalChunks: meta.totalChunks,
                                    message: "PROGRESS",
                                    fileName: meta.fileName,
                                    fileType: meta.fileType,
                                    fileSize: meta.fileSize,
                                    progress: progress
                                });
                            }
                            
                            // Tüm parçalar alındıysa, dosyayı birleştir
                            if (meta.receivedChunks === meta.totalChunks) {
                                console.log(`Tüm parçalar alındı (${meta.totalChunks}), dosya birleştiriliyor...`);
                                
                                // ÖNEMLI: Birleştirme işleminden ÖNCE hemen bir PREPARING mesajı gönderelim
                                // Bu mesaj ile kullanıcıya dosyanın hazırlanmakta olduğunu bildirelim
                                callback({
                                    dataType: DataType.FILE,
                                    fileId: data.fileId,
                                    fileName: meta.fileName,
                                    fileType: meta.fileType,
                                    message: "PREPARING", // Özel mesaj: Dosya hazırlanıyor
                                    fileSize: meta.fileSize,
                                    progress: 99 // %99 göster, hazırlanıyor anlamında
                                });
                                
                                // Dosya birleştirme işlemini asenkron olarak başlat
                                const createCompleteFile = async () => {
                                    try {
                                        // Aşamalı birleştirme için parçaları gruplara ayıralım
                                        const sortedIndices = Array.from(chunksMap.keys()).sort((a, b) => a - b);
                                        const MERGE_GROUP_SIZE = 200; // Daha büyük gruplar (daha hızlı birleştirme)
                                        
                                        // İlk grupla başlayalım
                                        let completeFile: Blob | null = null;
                                        
                                        // Parçaları gruplar halinde birleştirelim
                                        for (let i = 0; i < sortedIndices.length; i += MERGE_GROUP_SIZE) {
                                            const endIdx = Math.min(i + MERGE_GROUP_SIZE, sortedIndices.length);
                                            const groupIndices = sortedIndices.slice(i, endIdx);
                                            
                                            // Bu gruptaki parçaları al
                                            const groupChunks = groupIndices.map(idx => chunksMap.get(idx)!);
                                            
                                            // Bu grup için Blob oluştur
                                            const groupBlob = new Blob(groupChunks, { type: meta.fileType });
                                            
                                            // İlk grup mu yoksa sonraki gruplardan biri mi?
                                            if (completeFile === null) {
                                                completeFile = groupBlob;
                                            } else {
                                                // Önceki birleştirilmiş dosya ile bu grubu birleştir
                                                completeFile = new Blob([completeFile, groupBlob], { type: meta.fileType });
                                            }
                                            
                                            // Birleştirme işlemi esnasında tarayıcının donmaması için biraz bekleyelim
                                            await new Promise(resolve => setTimeout(resolve, 0)); // 0ms ile event loop'a teslim et
                                        }
                                        
                                        console.log(`Dosya birleştirildi, son boyut: ${completeFile!.size} bytes`);
                                        
                                        // Tamamlanmış dosyayı bildir
                                        callback({
                                            dataType: DataType.FILE,
                                            fileId: data.fileId,
                                            file: completeFile!, // Asıl dosyayı gönder
                                            fileName: meta.fileName,
                                            fileType: meta.fileType,
                                            message: "COMPLETE",
                                            fileSize: meta.fileSize,
                                            progress: 100
                                        });
                                        
                                        // Bellekte yer açmak için artık ihtiyaç duyulmayan parçaları temizleyelim
                                        chunksMap.clear();
                                        
                                        // Hash hesaplama işlemini arka planda başlat
                                        calculateFileHash(completeFile!).then((calculatedHash) => {
                                            console.log(`Alınan dosya hash değeri: ${calculatedHash}`);
                                            
                                            // Sender hash'i henüz gönderilmediyse, fileChunks'ı serbest bırakabilir, hafızada yer açabiliriz
                                            if (!meta.fileHash) {
                                                fileChunks.delete(data.fileId!);
                                            } else {
                                                // Hem hash hem de file tamamlandıysa, hash kontrolü yap
                                                const hashMatches = calculatedHash === meta.fileHash;
                                                console.log(`Hash kontrolü: ${hashMatches ? 'Başarılı ✅' : 'Başarısız ❌'}`);
                                                
                                                // Temizlik
                                                fileChunks.delete(data.fileId!);
                                                fileMetadata.delete(data.fileId!);
                                                
                                                // Hash sonucunu bildir
                                                callback({
                                                    dataType: DataType.FILE_HASH,
                                                    fileId: data.fileId,
                                                    fileName: meta.fileName,
                                                    message: hashMatches ? "HASH_MATCH" : "HASH_MISMATCH",
                                                    fileHash: calculatedHash
                                                });
                                            }
                                        }).catch(error => {
                                            console.error("Hash hesaplama hatası:", error);
                                            
                                            // Hash hesaplama hatası olsa bile dosya indirilmiş olacak
                                            callback({
                                                dataType: DataType.FILE_HASH,
                                                fileId: data.fileId,
                                                fileName: meta.fileName,
                                                message: "HASH_ERROR",
                                                fileHash: "error"
                                            });
                                            
                                            // Temizlik
                                            fileChunks.delete(data.fileId!);
                                            fileMetadata.delete(data.fileId!);
                                        });
                                    } catch (error) {
                                        console.error("Dosya birleştirme hatası:", error);
                                        
                                        // Hata olsa bile en azından bir hata mesajı bildirelim
                                        message.error(`"${meta.fileName}" dosyası birleştirilirken hata oluştu!`);
                                        
                                        // Hata durumunda da temizlik yapalım
                                        fileChunks.delete(data.fileId!);
                                        fileMetadata.delete(data.fileId!);
                                    }
                                };
                                
                                // Asenkron birleştirme işlemini başlat
                                createCompleteFile();
                            }
                        }
                    } 
                    // Hash bilgisini işle
                    else if (data.dataType === DataType.FILE_HASH && data.fileId) {
                        console.log(`Dosya hash değeri alındı: ${data.fileHash}`);
                        
                        const meta = fileMetadata.get(data.fileId);
                        if (meta) {
                            meta.fileHash = data.fileHash;
                            
                            // Tüm dosya parçaları zaten alındıysa, hash kontrolü yap
                            if (meta.receivedChunks === meta.totalChunks) {
                                // Dosya birleştirildi ve hash alındı, hash kontrolü yap
                                // Hash kontrolü indirme kısmında yapılır
                            }
                        }
                    } 
                    else {
                        // Dosya olmayan veriler doğrudan iletilir
                        callback(data);
                    }
                } catch (error) {
                    console.error("Veri işleme hatası:", error);
                }
            });
        }
    },
    clearDataListeners: (id: string): void => {
        if (!peer) {
            throw new Error("Peer henüz başlatılmadı");
        }
        if (!connectionMap.has(id)) {
            throw new Error("Bağlantı mevcut değil");
        }
        
        const conn = connectionMap.get(id);
        if (conn) {
            // PeerJS, removeAllListeners metodunu destekler
            conn.removeAllListeners('data');
            console.log(`${id} bağlantısı için veri dinleyicileri temizlendi`);
        }
    }
}