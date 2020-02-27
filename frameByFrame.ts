/*
* FrameByFrame handles the mechanism of drawing on a canvas one image after the other to give the impression that you are playing a video while scrolling
* TypeScript 3.4
*/

/*
Html example: 
<canvas id="stage"></canvas>
<div class="story">
  ...
</div>
*/

export interface FrameByFrameOption  {
  imageHighResDir?: string;
  imageLowResDir?: string;
  imagePrefix?: string;
  imageCountFirst?: number;
  imageCountLast?: number;
  imageExtension?: string;
  pxPerImg?: number;
  highResLoadDelay?: number;
  preLoadingPercentage?: number; // must be between 0 and 1
  forwardLoadingThreshold?: number; // must be between 0 and 1
  intervalTimeout?: number; // in ms
  intervalLoadPercentage?: number; // must be between 0 and 1
  debug?: boolean;
  onComplete?: () => void; // Triggered when the first initialization is over (and the first batch of images are loaded)
  onResizeCompleted?: () => void; // Triggered once a re-drawing on the canvas (which followed a windows resizing) is over
  onFrameUpdated?: (_: number) => void; // Triggered everytime a frame has been drawn on the canvas
}

interface LoadedImages {
  [key:number]: HTMLImageElement
}

interface ImageBase {
  img: HTMLImageElement;
  src: string;
  index: number
}

export class FrameByFrame {

  private _options: FrameByFrameOption = {
    imageHighResDir: '',
    imageLowResDir: '',
    imagePrefix: '',
    imageCountFirst: 0,
    imageCountLast: 9,
    pxPerImg: 27, // default 27 pixel for each frame
    highResLoadDelay: 250,
    preLoadingPercentage: 0.25,
    forwardLoadingThreshold: 0.25,
    intervalTimeout: 500,
    intervalLoadPercentage: 0.02,
    imageExtension: 'jpg',
    debug: false,
    onComplete: () => {
    },
    onResizeCompleted: () => {
    },
    onFrameUpdated: (i) => {
    }
  };

  private canvasEl: HTMLCanvasElement;
  private canvasCtx: CanvasRenderingContext2D;
  private storyEl?: HTMLElement;
  private loadedImages: LoadedImages = {}; // Images who have been attached to the dom with their src set
  private loadedHighResImages: LoadedImages = {}; // HD Images who have been attached to the dom with their src set
  private imagesPath: string[] = []; // Store all the path of the images, used as a reference throughout of the number of images
  private windowHeight: number;
  private forwardLoading: Promise<HTMLImageElement[]> = Promise.resolve([]);
  private isFowardLoading: boolean = false;

  get options(): FrameByFrameOption {
    return this._options;
  }

  set options(o: FrameByFrameOption) {
    Object.assign(this._options, o);
  }

  /*
  * canvasSelector: unique identifier of the canvas the user wants to draw on
  * storySelector: unique identifier of the story container. A story is all the text/icon/... that you want to be appearing while scrolling through the frames. NOTE: You always need one, the height is set on that element, even if you don't have any story to tell.
  * Strongly advised to call this constructor after the view (containing the canvas and the story) has init
  * Also, you should probably use
  * if ('scrollRestoration' in history) {
  *    history.scrollRestoration = 'manual';
  * } as there is not point for the browser to remember what it has already scrolled
  */
  constructor(canvasSelector: string, storySelector?: string, options?: FrameByFrameOption) {
    /* Fields Init */
    this.options = options;
    this.canvasEl = document.querySelector(canvasSelector);
    this.canvasCtx = this.canvasEl.getContext('2d');
    storySelector && (this.storyEl = document.querySelector(storySelector));
    this.windowHeight = document.body.getBoundingClientRect().height;
    this.imagesPath = this.getImagesPath();

    /* Load a first batch of images in medium quality */
    this.preloader().then(() => {
      this.debugLog('Preloader has finished ', this.loadedImages);

      /* Set the right size to the canvas/story, and load the first image (in HD) */
      this.setTheaterSize(true).then(() => {
        /* We need to redraw after resizing to prevent the image on the canvas from being erased */
        window.addEventListener('resize', () => this.setTheaterSize().then(() => this.options.onResizeCompleted()));

        let HDTimerId; /* This timer is set at every scroll and triggers the drawing of an HD image when no scroll event happened after an options defined amount of time */
        window.addEventListener('scroll', () => {
          clearTimeout(HDTimerId);

          HDTimerId = setTimeout(() => {
            this.drawOnScreenImage(true).then(() => this.debugLog('HD image loaded'));

          }, this.options.highResLoadDelay);

          /* To reflect the scroll pace on the canvas, we need to re-draw as we scroll */
          this.drawOnScreenImage();
        });

        /* We setup an interval to download images in the background */
        this.setIntervalLoad();
        this.options.onComplete();
      });
    });
  }

  /* Set an interval which will try loading image while idle */
  private setIntervalLoad() {
    /* Get the index of the highest loaded image */
    let latestIntervalLoadedImage: number = Number(Object.keys(this.loadedImages).reduce((a, b) => Number(a) > Number(b) ? a : b));

    const intervalId = setInterval(async () => {
      const numberOfImages = this.imagesPath.length;
      if(latestIntervalLoadedImage === numberOfImages-1) {
        this.debugLog('interval has been stopped');
        clearInterval(intervalId);
      }
      else if(!this.isFowardLoading) {
        let numberOfImagesToLoad = Math.floor(numberOfImages * this.options.intervalLoadPercentage);

        /* We keep rolling until we ACTUALLY load numberOfImagesToLoad img */
        while(numberOfImagesToLoad > 0 && latestIntervalLoadedImage < numberOfImages-1) {
          latestIntervalLoadedImage++;
          await this.loadImage(latestIntervalLoadedImage, false, true).then(
             () => numberOfImagesToLoad--,
             () => throw ('Unable to load ' + latestIntervalLoadedImage);
          );
        }
      }
    }, this.options.intervalTimeout);
  }

  /* Set the canvas size to the window size and give the full height (#of frames * # pxPerFrame) to the story. */
  private setTheaterSize(highRes?: boolean): Promise<HTMLImageElement> {
    // Set the canvas size to fullscreen
    this.canvasEl.width = window.innerWidth;
    this.canvasEl.height = window.innerHeight;
    this.storyEl && this.setHeight(this.storyEl, this.imagesPath.length * this.options.pxPerImg + this.windowHeight);

    // resizing clear the canvas so it must redraw
    return this.drawOnScreenImage(highRes);
  }

  /* Set the given val as height of the el. */
  private setHeight(el: HTMLElement, val: string|number|Function): void {
    if (typeof val === 'function') val = val();
    if (typeof val === 'string') el.style.height = val;
    else el.style.height = val + 'px';
  }

  /* Fill the imagesPath */
  private getImagesPath(): string[] {
    const imagesPath = [];
    for(let i = this.options.imageCountFirst; i <= this.options.imageCountLast; i++) {
      imagesPath.push(this.options.imagePrefix + i);
    }

    return imagesPath;
  }

  /* Draw the image to display on the screen */
  private drawOnScreenImage(highRes?: boolean): Promise<HTMLImageElement> {
    const requestedImageIndex = this.getRequestedImageIndex();

    const loadImageOnScreenPromsise = this.loadImage(requestedImageIndex, highRes);
    loadImageOnScreenPromsise.then((img) => {
      this.drawOnCanvas(img);
      this.forwardLoad(requestedImageIndex).then(() => this.debugLog('one lazy load has completed'));
      this.options.onFrameUpdated(requestedImageIndex);
    });

    return loadImageOnScreenPromsise;
  }

  /* Draw on the canvas as a background cover would do */
  private drawOnCanvas(img: HTMLImageElement): void {
    // Inspired by http://stackoverflow.com/questions/21961839/simulation-background-size-cover-in-canvas

	if(img) {	
	  const canvasWidth = this.canvasEl.width;
	  const canvasHeight = this.canvasEl.height;

	  const offsetX = 0.5;
	  const offsetY = 0.5;

	  const imageWidth = img.width;
	  const imageHeight = img.height;
	  const lowestRatio = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);

	  let resizedImageWidth = imageWidth * lowestRatio,
		resizedImageHeight = imageWidth * lowestRatio,
		sourceX,
		sourceY,
		sourceWidth,
		sourceHeight,
		adjustedRatio = 1;

	  if (Math.round(resizedImageWidth) < canvasWidth) adjustedRatio = canvasWidth / resizedImageWidth;
	  if (Math.round(resizedImageHeight) < canvasHeight) adjustedRatio = canvasHeight / resizedImageHeight;
	  resizedImageWidth *= adjustedRatio;
	  resizedImageHeight *= adjustedRatio;

	  sourceWidth = imageWidth / (resizedImageWidth / canvasWidth);
	  sourceHeight = imageHeight / (resizedImageHeight / canvasHeight);
	  sourceX = (imageWidth - sourceWidth) * offsetX;
	  sourceY = (imageHeight - sourceHeight) * offsetY;

	  if (sourceX < 0) sourceX = 0;
	  if (sourceY < 0) sourceY = 0;
	  if (sourceWidth > imageWidth) sourceWidth = imageWidth;
	  if (sourceHeight > imageHeight) sourceHeight = imageHeight;

	  this.canvasCtx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight)
	}
}
  }

  /* Load an Image asynchronously by setting its source */
  private async loadImage(index: number, highRes?: boolean, rejectAlreadyLoaded?: boolean): Promise<HTMLImageElement> {
    const loadedImages = highRes ? this.loadedHighResImages : this.loadedImages;

    const loadedImage = loadedImages[index];

    if(loadedImage)
      return rejectAlreadyLoaded ? Promise.reject() : Promise.resolve(loadedImage);
    else {
      const imgBase = this.createImageBase(index, highRes);
      return new Promise((resolve, reject) => {
        imgBase.img.addEventListener('load', () => {
          loadedImages[imgBase.index] = imgBase.img;
          resolve(imgBase.img);
        });

        imgBase.img.addEventListener('error', (err) => {
          reject(err);
        });

        imgBase.img.src = imgBase.src;
      });
    }
  }

  /* Create an ImageBase using the path from the imagesPath */
  private createImageBase(index: number, highRes?: boolean): ImageBase {
    const img = document.createElement('img');
    const imgSrcPath = highRes ? this.options.imageHighResDir : this.options.imageLowResDir;

    return {
      img: img,
      src: `${imgSrcPath}${this.imagesPath[index]}.${this.options.imageExtension}`,
      index: index
    };
  }

  /* Will load the percentage (defined in the options) of total images */
  private async preloader(): Promise<HTMLImageElement[]> {
    const promises: Promise<HTMLImageElement>[] = [];

    for(let i = 0; i < (this.imagesPath.length * this.options.preLoadingPercentage); i++) {
       promises.push(this.loadImage(i));
    }

    return Promise.all(promises);
  }

  /* Return the index of the image that should be displayed based on the scroll position */
  private getRequestedImageIndex(): number {
    const top: number = document.documentElement.scrollTop + this.windowHeight;

    let requestedImageIndex: number = Math.min(this.imagesPath.length -1, Math.floor((top / this.options.pxPerImg) - (this.windowHeight / this.options.pxPerImg)));

    // prevent index from being more than our last image
    if (requestedImageIndex >= this.imagesPath.length - 1) {
      requestedImageIndex = this.imagesPath.length - 1;
    }

    return requestedImageIndex;
  }

  /* We had the lazy threshold to the requestedImageIndex to define until where we lazy load */
  private async forwardLoad(requestedImageIndex): Promise<HTMLImageElement[]> {
    await this.forwardLoading;

    const promises = [];
    const ub = this.getForwardLoadingUpperBound(requestedImageIndex);
    for(let i = (requestedImageIndex + 1); i < ub; i++) {
      promises.push(this.loadImage(i));
    }

    this.forwardLoading = Promise.all(promises);
    this.isFowardLoading = true;
    return this.forwardLoading.then(() => this.isFowardLoading = false);
  }

  /* Return the upper bound of the forward loading based on the current requested image, the number of images and the forwardLoadingThreshold */
  private getForwardLoadingUpperBound(requestedImageIndex) {
    return Math.min(requestedImageIndex + (this.imagesPath.length * this.options.forwardLoadingThreshold), this.imagesPath.length);
  }

  private debugLog(msg?: any, ...optionalParams: any[]): void {
    this.options.debug && console.log(msg, ...optionalParams);
  }
}