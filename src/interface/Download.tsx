import React from 'react';
import {Download} from "../models/file.model";
import '../styles/Download.css';
import {Badge, Card, Progress, Tag} from "antd";
import {CheckCircleOutlined, SyncOutlined} from "@ant-design/icons";

interface DownloadItemProps {
    download: Download
    speedText: string
}

export const DownloadItem: React.FC<DownloadItemProps> = ({download, speedText}) => {
    // Hazırlanıyor durumunu kontrol et
    const isPreparing = download.status === 'preparing';
    
    // Durum bilgisini belirle
    let statusTag = null;
    if (download.complete) {
        statusTag = <Tag icon={<CheckCircleOutlined/>} color="success">Tamamlandı</Tag>;
    } else if (isPreparing) {
        statusTag = <Tag icon={<SyncOutlined spin/>} color="processing">Hazırlanıyor</Tag>;
    } else if (download.progress > 0) {
        statusTag = <Tag color="processing">İndiriliyor</Tag>;
    } else {
        statusTag = <Tag color="default">Bekliyor</Tag>;
    }
    
    // İlerleme durumu ve hız bilgisini belirle
    const progressInfo = isPreparing 
        ? "Dosya hazırlanıyor..."
        : download.complete 
            ? "Tamamlandı" 
            : `${download.progress}% | ${speedText}`;
    
    // Progress çubuğunun rengini belirle
    const progressColor = isPreparing 
        ? "#1677ff" // Mavi (Hazırlanıyor)
        : download.complete 
            ? "#52c41a" // Yeşil (Tamamlandı)
            : undefined; // Varsayılan (Devam ediyor)
    
    return (
        <Card className="download-card" bordered={false}>
            <div className="download-header">
                <div className="download-filename">{download.filename}</div>
                <div className="download-status">
                    {statusTag}
                </div>
            </div>
            <div className="download-info">
                <div className="filesize">{download.filesize}</div>
                <div className="download-progress-info">{progressInfo}</div>
            </div>
            <Progress 
                percent={download.progress} 
                status={download.complete ? "success" : "active"} 
                strokeColor={progressColor}
            />
        </Card>
    );
}

interface DownloadListProps {
    downloads: Record<string, Download>
    downloadSpeeds: Record<string, number>
}

export const DownloadList: React.FC<DownloadListProps> = ({downloads, downloadSpeeds}) => {
    const getSpeedText = (fileId: string): string => {
        const speed = downloadSpeeds[fileId] || 0;
        if (speed === 0) return '0 KB/s';
        
        if (speed < 1024) {
            return `${speed.toFixed(1)} KB/s`;
        } else {
            return `${(speed / 1024).toFixed(1)} MB/s`;
        }
    }
    
    return (
        <div>
            <h3 className="download-title">İndirilen Dosyalar</h3>
            <div className="download-list">
                {Object.keys(downloads).length === 0 ? (
                    <div className="no-downloads">İndirilen dosya bulunmuyor</div>
                ) : (
                    Object.entries(downloads).map(([fileId, download]) => (
                        <DownloadItem key={fileId} download={download} speedText={getSpeedText(fileId)}/>
                    ))
                )}
            </div>
        </div>
    );
} 