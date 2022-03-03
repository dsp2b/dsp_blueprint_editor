import { TextureLoader, WebGLRenderer, Texture, RGBAFormat, UnsignedByteType, Vector2, DataTexture } from 'three';
import { allIconIds, iconUrl } from './data/icons';

const WIDTH = 20;
const HEIGHT = 20;
const ICON_SIZE = 80;

export class IconTexture {
    static readonly WIDTH = WIDTH;
    static readonly HEIGHT = HEIGHT;

    texture: Texture;
    private iconIds = new Map<number, number>();
    private loaded = new Array<boolean>(WIDTH * HEIGHT);
    private loader = new TextureLoader();

    constructor(private renderer: WebGLRenderer) {
        this.texture = new DataTexture(
            new Uint8Array(WIDTH * ICON_SIZE * HEIGHT * ICON_SIZE * 4),
            WIDTH * ICON_SIZE, HEIGHT * ICON_SIZE,
        );
        this.texture.name = 'icons';
        this.texture.format = RGBAFormat;
        this.texture.type = UnsignedByteType;
        this.texture.flipY = true;
        this.texture.needsUpdate = true;
        this.renderer.initTexture(this.texture);

        let nextIndex = 0;
        for (const i of allIconIds()) {
            if (nextIndex >= WIDTH * HEIGHT)
                throw new Error('IconTexture too small');
            this.iconIds.set(i, nextIndex);
            nextIndex++;
        }

        for (let i = 0; i < this.loaded.length; i++)
            this.loaded[i] = false;
    }

    requestIcon(iconId: number) {
        const index = this.iconIds.get(iconId);
        if (index === undefined)
            throw new Error('unknown icon ' + iconId);

        if (this.loaded[iconId])
            return index;
        this.loaded[iconId] = true;

        (async () => {
            const texture = await this.loader.loadAsync(await iconUrl(iconId));
            const pos = new Vector2(index % WIDTH, Math.floor(index / WIDTH));
            pos.multiplyScalar(ICON_SIZE);
            this.renderer.copyTextureToTexture(pos, texture, this.texture);
            texture.dispose();
        })();

        return index;
    }
}
