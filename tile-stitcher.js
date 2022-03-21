const fs = require('fs');
const readline = require('readline');
const { createCanvas, loadImage } = require('canvas');

const METADATA_FILENAME = "metadata.json";
const TILE_SIZE = 256;

/**
 * @typedef Metadata
 * @prop {string} name '2021-11',
 * @prop {string} description '',
 * @prop {string} legend '',
 * @prop {string} attribution 'Rendered with <a href="https://www.maptiler.com/desktop/">MapTiler Desktop</a>',
 * @prop {string} type 'overlay',
 * @prop {string} version '1',
 * @prop {string} format 'png',
 * @prop {string} format_arguments '',
 * @prop {string} minzoom '8',
 * @prop {string} maxzoom '16',
 * @prop {string} bounds '113.516359,22.067786,114.502779,22.568333',
 * @prop {string} scale '2.000000',
 * @prop {string} profile 'mercator',
 * @prop {string} scheme 'tms',
 * @prop {string} generator 'MapTiler Desktop Pro 10.3-0934099ad7'
*/
/**
 * @typedef {{scale: number;zoom: number;minX: number;maxX: number;minY: number;maxY: number;}} Params
 */

const metadata = getMetadata();

if (!metadata) {
    process.exit();
}

const params = {
    scale: +metadata.scale,
    zoom: NaN,
    minX: NaN,
    maxX: NaN,
    minY: NaN,
    maxY: NaN,
    outputFilename: null,
};

run();

async function run () {

    const args = process.argv;

    if (args.some(s => s.match(/-h|--help/))) {
        console.log(
`Looks in current directory for ${METADATA_FILENAME}
Usage:
    -z|--zoom Z                                 Specify zoom level
    -b|--bounds minLon,minLat,maxLon,maxLat     Specify max bounds
    --full                                      Use all available tiles
    -o|--output filename.png                    Specify output filename
    --info                                      Print info found in manifest
    -h|--help                                   Show help`);
        return;
    }

    const zoomArgIndex = args.findIndex(s => s.match(/-z|--zoom/));
    const boundsArgIndex = args.findIndex(s => s.match(/-b|--bounds/));
    const outputArgIndex = args.findIndex(s => s.match(/-o|--output/));

    if (zoomArgIndex > 0 && zoomArgIndex < args.length - 1) {
        params.zoom = +args[zoomArgIndex + 1];
    }

    if (args.includes("--info")) {
        console.log(`Zoom levels: ${metadata.minzoom}-${metadata.maxzoom}`);
        console.log(`Lon/Lat Bounds: ${metadata.bounds}`);

        const bounds = metadata.bounds.split(",").map(s => +s);

        console.log("Tile Number Ranges:");

        for (let zoom = +metadata.minzoom; zoom <= +metadata.maxzoom; zoom++) {
            const topLeftTile = lonLatToXY(bounds[0], bounds[3], zoom);
            const bottomRightTile = lonLatToXY(bounds[2], bounds[1], zoom);

            const tlX = Math.floor(topLeftTile.x);
            const tlY = Math.floor(topLeftTile.y);
            const brX = Math.floor(bottomRightTile.x);
            const brY = Math.floor(bottomRightTile.y);

            const w = brX - tlX + 1;
            const h = brY - tlY + 1;

            console.log(`\tZoom ${zoom}: (${tlX},${tlY}) - (${brX},${brY}) [${w} x ${h} = ${w * h} tiles]`);
        }

        console.log(`Scale: ${metadata.scale}`);

        const imageSize = TILE_SIZE * +metadata.scale;

        console.log(`Image Size: ${imageSize}x${imageSize}`);

        console.log("Total Image Size:");

        for (let zoom = +metadata.minzoom; zoom <= +metadata.maxzoom; zoom++) {
            const topLeftTile = lonLatToXY(bounds[0], bounds[3], zoom);
            const bottomRightTile = lonLatToXY(bounds[2], bounds[1], zoom);

            const tlX = Math.floor(topLeftTile.x);
            const tlY = Math.floor(topLeftTile.y);
            const brX = Math.floor(bottomRightTile.x);
            const brY = Math.floor(bottomRightTile.y);

            const w = brX - tlX + 1;
            const h = brY - tlY + 1;

            console.log(`\tZoom ${zoom}: ${w * imageSize} pixels x ${h * imageSize} pixels`);
        }

        return;
    }

    if (args.includes("--full")) {
        if (isNaN(params.zoom)) {
            console.log("argument '--full' requires  argument '--zoom'");
            return;
        }

        const bounds = metadata.bounds.split(",").map(s => +s);
        const topLeftTile = lonLatToXY(bounds[0], bounds[3], params.zoom);
        const bottomRightTile = lonLatToXY(bounds[2], bounds[1], params.zoom);

        params.minX = Math.floor(topLeftTile.x);
        params.minY = Math.floor(topLeftTile.y);
        params.maxX = Math.ceil(bottomRightTile.x);
        params.maxY = Math.ceil(bottomRightTile.y);
    } else if (boundsArgIndex > 0 && boundsArgIndex < args.length - 1) {

        const maxBounds = metadata.bounds.split(",").map(s => +s);
        const maxTopLeftTile = lonLatToXY(maxBounds[0], maxBounds[3], params.zoom);
        const maxBottomRightTile = lonLatToXY(maxBounds[2], maxBounds[1], params.zoom);

        const sourceMinX = Math.floor(maxTopLeftTile.x);
        const sourceMinY = Math.floor(maxTopLeftTile.y);
        const sourceMaxX = Math.ceil(maxBottomRightTile.x);
        const sourceMaxY = Math.ceil(maxBottomRightTile.y);

        const bounds = args[boundsArgIndex + 1].split(",").map(s => +s);
        const topLeftTile = lonLatToXY(bounds[0], bounds[3], params.zoom);
        const bottomRightTile = lonLatToXY(bounds[2], bounds[1], params.zoom);

        const minX = Math.floor(topLeftTile.x);
        const minY = Math.floor(topLeftTile.y);
        const maxX = Math.ceil(bottomRightTile.x);
        const maxY = Math.ceil(bottomRightTile.y);

        params.minX = Math.max(sourceMinX, minX);
        params.minY = Math.max(sourceMinY, minY);
        params.maxX = Math.min(sourceMaxX, maxX);
        params.maxY = Math.min(sourceMaxY, maxY);

    }

    await askParams(metadata, params);

    if (outputArgIndex > 0 && outputArgIndex < args.length - 1) {
        params.outputFilename = args[outputArgIndex + 1];
    } else {
        params.outputFilename = `output-${params.zoom}.png`;
    }

    const imageWidth = (params.maxX - params.minX) * params.scale * TILE_SIZE;
    const imageHeight = (params.maxY - params.minY) * params.scale * TILE_SIZE;

    console.log(`Image size: ${imageWidth}x${imageHeight}`);

    if (imageWidth <= 0 || imageHeight <= 0) {
        console.log("Invalid image size");
        return;
    }

    const canvas = createCanvas(imageWidth, imageHeight);
    const context = canvas.getContext("2d");

    async function placeTile (z, x, y) {
        const filename = `${z}/${x}/${y}.png`;
        try {
            const image = await loadImage(filename);
            context.drawImage(image, (x - params.minX) * params.scale * TILE_SIZE, (y - params.minY) * params.scale * TILE_SIZE);
        } catch (e) {
            console.debug(`Image ${filename} not found`);
        }
    }

    for (let x = params.minX; x < params.maxX; x++) {
        for (let y = params.minY; y < params.maxY; y++) {
            await placeTile(params.zoom, x, y);
        }
    }

    const buffer = canvas.toBuffer('image/png')
    fs.writeFileSync(params.outputFilename, buffer);

    console.log(`Written ${(params.maxX - params.minX) * (params.maxY - params.minY)} tiles.`);
}


/**
 * @param {Metadata} metadata
 * @param {Params} params
 */
async function askParams (metadata, params) {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    /**
     *
     * @param {string} text
     * @param {number} minValue
     * @param {number} maxValue
     * @param {number} [initial]
     * @returns {Promise<number>}
     */
    function asyncQuestion (text, minValue, maxValue, initial = NaN) {
        return new Promise(resolve => {

            const fn = () => {
                rl.question(`${text} (range: ${minValue} - ${maxValue}) ${isNaN(initial)?"":`(default: ${initial}) `}`, a => {
                    if (a.length === 0 && !isNaN(initial)) {
                        resolve(initial);
                        return;
                    }

                    const answer = +a;

                    if (answer < minValue || answer > maxValue) {
                        fn();
                    } else {
                        resolve(answer);
                    }
                });
            };

            fn();

        });
    }

    if (isNaN(params.zoom)) {
        params.zoom = await asyncQuestion(`What zoom level?`, +metadata.minzoom, +metadata.maxzoom);
    }

    const bounds = metadata.bounds.split(",").map(s => +s);
    const topLeftTile = lonLatToXY(bounds[0], bounds[3], params.zoom);
    const bottomRightTile = lonLatToXY(bounds[2], bounds[1], params.zoom);

    const tlX = Math.floor(topLeftTile.x);
    const tlY = Math.floor(topLeftTile.y);
    const brX = Math.ceil(bottomRightTile.x);
    const brY = Math.ceil(bottomRightTile.y);

    if (isNaN(params.minX)) {
        params.minX = await asyncQuestion(`Eastern tile?`, tlX, brX, tlX);
    }

    if (isNaN(params.maxX)) {
        params.maxX = await asyncQuestion(`Western tile?`, params.minX, brX, brX);
    }

    if (isNaN(params.minY)) {
        params.minY = await asyncQuestion(`Northern tile?`, tlY, brY, tlY);
    }

    if (isNaN(params.maxY)) {
        params.maxY = await asyncQuestion(`Southern tile?`, params.minY, brY, brY);
    }

    rl.close();

    return params;
}

/**
 *
 * @returns {Metadata}
 */
function getMetadata () {
    let fh;

    try {
        fh = fs.openSync(METADATA_FILENAME, "r");

    } catch (e) {
        console.log("Manifest not found");
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(fh, 'utf8'));
    } catch (e) {
        console.log("Couldn't parse metadata");
        return null;
    }
}

/**
 *
 * @param {number} lon Degrees
 * @param {number} lat Degrees
 * @param {number} zoom
 */
function lonLatToXY (lon, lat, zoom) {
    return { x: (lon+180)/360*Math.pow(2,zoom), y: (1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom) };
}