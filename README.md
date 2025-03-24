# P2P Dosya Transfer Uygulaması

Bu uygulama, kullanıcıların arasında doğrudan P2P (peer-to-peer) bağlantı üzerinden dosya paylaşımını sağlayan bir web uygulamasıdır.

## Özellikler

- Doğrudan P2P dosya aktarımı
- Dosya hash kontrolü
- İlerleme takibi
- Bağlantı kopma durumunda hata yönetimi

## Kurulum ve Çalıştırma

### Geleneksel Yöntem

Uygulamayı başlatmak için:

```bash
# Bağımlılıkları yükleyin
npm install

# Uygulamayı çalıştırın
npm run start-all
```

### Docker ile Çalıştırma

Docker kullanarak uygulamayı çalıştırmak için:

```bash
# Docker imajını oluşturun ve çalıştırın
docker-compose up

# Arka planda çalıştırmak için
docker-compose up -d
```

Docker olmadan sadece üretim ortamında çalıştırmak için:

```bash
docker build -t payzen-app .
docker run -p 3000:3000 payzen-app
```

## Geliştirme

Geliştirme modunda çalıştırmak için:

```bash
npm run dev
```

## Nasıl Kullanılır

1. Uygulamayı başlatın ve tarayıcıda açın
2. 'Yeni Oda Oluştur' düğmesine tıklayın veya mevcut bir oda kodunu girin
3. Dosya göndermek için 'Dosya Ekle' düğmesine tıklayın ve göndermek istediğiniz dosyaları seçin
4. Alıcı kişiye oda kodunu gönderin
5. Alıcı aynı kodu girerek odaya katıldığında dosya transferi otomatik olarak başlayacaktır

## Sistem Mimarisi

Sistem iki ana bileşenden oluşur:

1. **İstemci (Client)**: React tabanlı kullanıcı arayüzü, WebRTC bağlantı yönetimi, dosya parçalama
2. **Relay Sunucusu**: Express.js tabanlı API sunucusu, P2P bağlantı kurulamadığında dosya aktarımına aracılık eder

## Sorun Giderme

- **Bağlantı Hataları**: Firewall veya NAT arkasındaysanız, P2P bağlantısı kurulamayabilir. Bu durumda sistem otomatik olarak relay sunucusunu kullanır.
- **Dosya Transferi Yavaş**: Büyük dosyalar için transfer hızı, internet bağlantınızın upload/download hızına bağlıdır.
- **Sunucu Başlatma Hatası**: Port 3001 başka bir uygulama tarafından kullanılıyorsa, server/index.ts dosyasından PORT değişkenini değiştirin.

## Lisans

MIT