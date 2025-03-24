const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Renk kodları
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    reset: '\x1b[0m'
};

// Yol tanımları
const ROOT_DIR = __dirname;
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const isWindows = os.platform() === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// Başlık
console.log(`${colors.cyan}==================================${colors.reset}`);
console.log(`${colors.cyan}  P2P Dosya Transfer Sistemi      ${colors.reset}`);
console.log(`${colors.cyan}==================================${colors.reset}`);

// Sunucu dizini kontrolü
if (!fs.existsSync(SERVER_DIR)) {
    console.error(`${colors.red}Hata: 'server' dizini bulunamadı.${colors.reset}`);
    process.exit(1);
}

// Sunucu oturum dizinini oluştur
const SESSION_DIR = path.join(SERVER_DIR, 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
    try {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        console.log(`${colors.green}Oturum dizini oluşturuldu: ${SESSION_DIR}${colors.reset}`);
    } catch (err) {
        console.error(`${colors.red}Oturum dizini oluşturulamadı: ${err.message}${colors.reset}`);
    }
}

// Çalışan işlemler
let clientProcess = null;
let serverProcess = null;

// İstemci (React) uygulamasını başlat
function startClient() {
    console.log(`${colors.green}İstemci uygulaması başlatılıyor...${colors.reset}`);
    
    clientProcess = spawn(npmCmd, ['start'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        shell: true
    });

    clientProcess.stdout.on('data', (data) => {
        console.log(`${colors.green}[İSTEMCİ] ${colors.reset}${data.toString().trim()}`);
    });

    clientProcess.stderr.on('data', (data) => {
        console.error(`${colors.yellow}[İSTEMCİ] ${colors.reset}${data.toString().trim()}`);
    });
    
    clientProcess.on('error', (error) => {
        console.error(`${colors.red}İstemci başlatılamadı: ${error.message}${colors.reset}`);
    });
    
    clientProcess.on('close', (code) => {
        if (code !== 0) {
            console.log(`${colors.yellow}İstemci kapandı, çıkış kodu: ${code}${colors.reset}`);
        }
    });
}

// Sunucu uygulamasını başlat
function startServer() {
    console.log(`${colors.blue}Relay sunucusu başlatılıyor...${colors.reset}`);
    
    serverProcess = spawn(npmCmd, ['run', 'server'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        shell: true
    });

    serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`${colors.blue}[SUNUCU] ${colors.reset}${output}`);
        
        // Sunucu hazır olduğunda istemciyi başlat
        if (output.includes('Relay sunucusu başlatıldı')) {
            startClient();
        }
    });

    serverProcess.stderr.on('data', (data) => {
        console.error(`${colors.magenta}[SUNUCU] ${colors.reset}${data.toString().trim()}`);
    });
    
    serverProcess.on('error', (error) => {
        console.error(`${colors.red}Sunucu başlatılamadı: ${error.message}${colors.reset}`);
    });
    
    serverProcess.on('close', (code) => {
        if (code !== 0) {
            console.log(`${colors.yellow}Sunucu kapandı, çıkış kodu: ${code}${colors.reset}`);
        }
    });
}

// Temiz kapatma işlevi
function cleanup() {
    console.log(`\n${colors.yellow}Sistemler kapatılıyor...${colors.reset}`);
    
    if (clientProcess) {
        clientProcess.kill();
    }
    
    if (serverProcess) {
        serverProcess.kill();
    }
    
    process.exit(0);
}

// Kapatma sinyallerini yakalamak
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (err) => {
    console.error(`${colors.red}Yakalanmamış istisna: ${err.message}${colors.reset}`);
    cleanup();
});

// Önce sunucuyu başlat
startServer();

console.log(`${colors.cyan}Sistemler başlatılıyor, lütfen bekleyin...${colors.reset}`);
console.log(`${colors.yellow}Çıkış yapmak için Ctrl+C tuşlarına basın.${colors.reset}`); 