/* 
 * Copyright (C) 2025-present YouGo (https://github.com/youg-o)
 * This program is licensed under the GNU Affero General Public License v3.0.
 * You may redistribute it and/or modify it under the terms of the license.
 * 
 * Attribution must be given to the original author.
 * This program is distributed without any warranty; see the license for details.
 */



let mainTitleObserver: MutationObserver | null = null;

// Utility Functions
function updateMainTitleElement(element: HTMLElement, title: string, videoId: string): void {
    mainTitleLog('Updating element with title:', title);
    element.innerText = title;
    element.setAttribute('NMT', videoId);
    element.removeAttribute('is-empty');
    titleCache.setElement(element, title);
}

function updatePageTitle(mainTitle: string): void {
        mainTitleLog('Updating page title with:', mainTitle);
    const channelName = document.querySelector('ytd-channel-name yt-formatted-string')?.textContent || '';
    document.title = `${mainTitle} - ${channelName} - YouTube`;
}


// Main Title Function
async function refreshMainTitle(): Promise<void> {
    const data = await browser.storage.local.get('settings');
    const settings = data.settings as ExtensionSettings;
    if (!settings?.titleTranslation) return;

    const mainTitle = document.querySelector('h1.ytd-watch-metadata > yt-formatted-string') as HTMLElement;
    if (mainTitle && window.location.pathname === '/watch' && !titleCache.hasElement(mainTitle)) {
        mainTitleLog('Processing main title element');
        const videoId = new URLSearchParams(window.location.search).get('v');
        if (videoId) {
            // Check if element has already been processed with this videoId
            const currentNMT = mainTitle.getAttribute('NMT');
            if (currentNMT === videoId) {
                mainTitleLog('Title already processed for video:', videoId);
                return;
            }

            try {
                const originalTitle = await titleCache.getOriginalTitle(
                    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}`
                );
                updateMainTitleElement(mainTitle, originalTitle, videoId);
                updatePageTitle(originalTitle);
            } catch (error) {
                mainTitleLog(`Failed to update main title:`, error);
            }
        }
    }
}


function setupMainTitleObserver() {
    waitForElement('ytd-watch-flexy').then((watchFlexy) => {
        mainTitleLog('Setting up video-id observer');
        mainTitleObserver = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'video-id') {
                    titleCache.clear();
                    
                    const newVideoId = (mutation.target as HTMLElement).getAttribute('video-id');
                    mainTitleLog('Video ID changed:', newVideoId);
                    mainTitleLog('Cache cleared');
                    
                    // Get the current page URL to check against
                    const currentUrl = window.location.href;
                    /*mainTitleLog('Current URL:', currentUrl);*/
                    
                    // Wait for title element and monitor its changes
                    const titleElement = await waitForElement('ytd-watch-metadata yt-formatted-string.style-scope.ytd-watch-metadata');
                    let attempts = 0;
                    const maxAttempts = 20;
                    
                    while (attempts < maxAttempts) {
                        const pageUrl = window.location.href;
                        
                        if (pageUrl === currentUrl && titleElement.textContent) {
                            browser.storage.local.get('settings').then(async (data: Record<string, any>) => {
                                const settings = data.settings as ExtensionSettings;
                                if (settings?.titleTranslation) {
                                    await refreshMainTitle();
                                    mainTitleLog('Title updated:', titleElement.textContent);
                                }
                            });
                            break;
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 100));
                        attempts++;
                    }
                }
            }
        });

        mainTitleObserver.observe(watchFlexy, {
            attributes: true,
            attributeFilter: ['video-id']
        });
    });
}