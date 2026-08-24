// ═══════════════════════════════════════════
// AVATARS — свои аватарки носителей
// ═══════════════════════════════════════════
//
// Картинки уходят на сервер SillyTavern через /api/images/upload — туда же,
// куда складываются изображения от генераторов. В настройках чата остаётся
// только путь.
//
// Почему так, а не в браузерное хранилище: файл на сервере виден с любого
// устройства, переживает чистку кэша и переустановку расширения. И в самих
// настройках ST (это общий файл на всё приложение) не оказывается мегабайтов
// base64, которые замедлили бы Таверну целиком.

const MAX_DIM = 256;

// Ужимаем перед отправкой: аватарке хватает 256px, а снимок с телефона
// может весить несколько мегабайт.
export function readImageFile(file, maxDim = MAX_DIM) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type?.startsWith('image/')) {
            reject(new Error('Это не изображение'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width: w, height: h } = img;
                if (w > maxDim || h > maxDim) {
                    const s = Math.min(maxDim / w, maxDim / h);
                    w = Math.round(w * s);
                    h = Math.round(h * s);
                }
                const c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                // Отдаём только полезную часть, без префикса data:
                resolve(c.toDataURL('image/png').split(',')[1]);
            };
            img.onerror = () => reject(new Error('Не удалось прочитать изображение — битый файл или неподдерживаемый формат'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
    });
}

// Кладёт картинку в /user/images/lifeweaver и возвращает путь
export async function uploadAvatar(base64, label) {
    const ctx = typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : null;
    if (!ctx?.getRequestHeaders) throw new Error('Нет доступа к контексту SillyTavern');

    const safe = String(label || 'avatar').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: ctx.getRequestHeaders(),
        body: JSON.stringify({
            image: base64,
            format: 'png',
            ch_name: 'lifeweaver',
            filename: `lw_${safe}_${Date.now()}`,
        }),
    });
    if (!response.ok) throw new Error(`Загрузка не удалась (${response.status})`);
    const result = await response.json();
    if (!result?.path) throw new Error('Сервер не вернул путь к файлу');
    return result.path;
}
