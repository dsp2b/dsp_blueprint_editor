import { TextureLoader, WebGLRenderer, Texture, RGBAFormat, UnsignedByteType, Vector2, SRGBColorSpace } from 'three';
import { allIconIds, iconUrl } from './data/icons';

const WIDTH = 24;
const HEIGHT = 24;
const ICON_SIZE = 80;

export class IconTexture {
    static readonly WIDTH = WIDTH;
    static readonly HEIGHT = HEIGHT;

    texture: Texture;
    private iconIds = new Map<number, number>();
    /** 已开始加载（或已加载）的图集格；加载失败时移除，下次请求重试 */
    private loaded = new Set<number>();
    private disposed = false;
    private loader = new TextureLoader();

    constructor(private renderer: WebGLRenderer) {
        const emptyCanvas = document.createElement('canvas');
        emptyCanvas.width = WIDTH * ICON_SIZE;
        emptyCanvas.height = HEIGHT * ICON_SIZE;
        this.texture = new Texture(emptyCanvas);
        this.texture.name = 'icons';
        this.texture.format = RGBAFormat;
        this.texture.type = UnsignedByteType;
        this.texture.flipY = true;
        this.texture.needsUpdate = true;
        this.texture.colorSpace = SRGBColorSpace;
        this.renderer.initTexture(this.texture);

        let nextIndex = 1; // 0 is reserved for empty icon
        for (const i of allIconIds()) {
            if (nextIndex >= WIDTH * HEIGHT)
                throw new Error('IconTexture too small');
            this.iconIds.set(i, nextIndex);
            nextIndex++;
        }
    }

    /** 换蓝图时释放图集；之后才到达的图标不再写入（否则会把已释放的贴图重新上传一份） */
    dispose() {
        this.disposed = true;
        this.texture.dispose();
    }

    requestIcon(iconId: number) {
        const index = this.iconIds.get(iconId);
        if (index === undefined) {
            console.warn(`Unknown icon ${iconId}`)
            return 0;
        }

        if (this.loaded.has(index) || this.disposed)
            return index;
        this.loaded.add(index);

        (async () => {
            const texture = await this.loader.loadAsync(await iconUrl(iconId));
            if (this.disposed) {
                texture.dispose();
                return;
            }
            const pos = new Vector2(index % WIDTH, Math.floor(index / WIDTH));
            pos.multiplyScalar(ICON_SIZE);
            this.renderer.copyTextureToTexture(pos, texture, this.texture);
            texture.dispose();
        })().catch(e => {
            this.loaded.delete(index);
            console.warn(`icon ${iconId} failed to load`, e);
        });

        return index;
    }
}
