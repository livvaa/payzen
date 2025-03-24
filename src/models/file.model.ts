export interface Upload {
    filename: string;
    progress: number;
    complete: boolean;
    filesize: string;
}

export interface Download {
    filename: string;
    progress: number;
    complete: boolean;
    filesize: string;
    status?: 'preparing' | 'downloading' | 'completed' | 'error'; // Yeni: İndirme durumu
} 