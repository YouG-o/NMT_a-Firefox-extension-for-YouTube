/* 
 * Copyright (C) 2025-present YouGo (https://github.com/youg-o)
 * This program is licensed under the GNU Affero General Public License v3.0.
 * You may redistribute it and/or modify it under the terms of the license.
 * 
 * Attribution must be given to the original author.
 * This program is distributed without any warranty; see the license for details.
 */



// Global variables
let otherTitlesObserver: MutationObserver | null = null;

// Optimized cache manager
class TitleCache {
    private apiCache = new Map<string, string>();

    clear(): void {
    }

    hasElement(element: HTMLElement): boolean {        
        return false;
    }

    setElement(element: HTMLElement, title: string): void {
        otherTitlesLog('Element caching disabled');
    }

    async getOriginalTitle(url: string): Promise<string> {
        if (this.apiCache.has(url)) {
            otherTitlesLog('Using cached API response for:', url);
            return this.apiCache.get(url)!;
        }
        
        otherTitlesLog('Fetching new title from API:', url);
        try {
            const response = await fetch(url);
            const data = await response.json();
            this.apiCache.set(url, data.title);
            otherTitlesLog('Received title from API:', data.title);
            return data.title;
        } catch (error) {
            otherTitlesLog(`API request failed, using title attribute as fallback:`, error);
            const videoElement = document.querySelector(`a[href*="${url.split('v=')[1]}"] #video-title`);
            return videoElement?.getAttribute('title') || '';
        }
    }
}

const titleCache = new TitleCache();



// Utility Functions
function updateOtherTitleElement(element: HTMLElement, title: string, videoId: string): void {
    otherTitlesLog('Updating element with title:', title);
    
    // Inject CSS if not already done
    if (!document.querySelector('#nmt-style')) {
        const style = document.createElement('style');
        style.id = 'nmt-style';
        style.textContent = `
            #video-title[nmt] > span {
                display: none;
            }

            #video-title[nmt]::after {
                content: attr(title);
                font-size: 1.4rem;  /* Rétablit la taille du texte pour notre titre */
            }
        `;
        document.head.appendChild(style);
    }

    // Wrap existing text in a span if not already done
    if (!element.querySelector('span')) {
        element.innerHTML = `<span>${element.textContent}</span>`;
    }

    element.setAttribute('title', title);
    element.setAttribute('nmt', videoId);
    titleCache.setElement(element, title);
}


// Other Titles Function
async function refreshOtherTitles(): Promise<void> {
    const data = await browser.storage.local.get('settings');
    const settings = data.settings as ExtensionSettings;
    if (!settings?.titleTranslation) return;

    // Handle recommended video titles
    const recommendedTitles = document.querySelectorAll('#video-title') as NodeListOf<HTMLElement>;
    otherTitlesLog('Found recommended titles:', recommendedTitles.length);

    for (const titleElement of recommendedTitles) {
        if (!titleCache.hasElement(titleElement)) {
            otherTitlesLog('Processing recommended title:', titleElement.textContent);
            const videoUrl = titleElement.closest('a')?.href;
            if (videoUrl) {
                const videoId = new URLSearchParams(new URL(videoUrl).search).get('v');
                if (videoId) {
                    // Check if element has already been processed with this videoId
                    const currentNMT = titleElement.getAttribute('NMT');
                    if (currentNMT === videoId) {
                        otherTitlesLog('Title already processed for video:', videoId);
                        continue;
                    }

                    try {
                        const originalTitle = await titleCache.getOriginalTitle(
                            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}`
                        );
                        updateOtherTitleElement(titleElement, originalTitle, videoId);
                    } catch (error) {
                        otherTitlesLog(`Failed to update recommended title:`, error);
                    }
                }
            }
        }
    }

    // Handle search results
    await handleSearchResults();
}


// Observers Setup
function setupOtherTitlesObserver() {
    // Observer for home page | Channel page
    waitForElement('#contents.ytd-rich-grid-renderer').then((contents) => {
        const gridObserver = new MutationObserver(() => {
            refreshOtherTitles();
        });

        gridObserver.observe(contents, {
            childList: true
        });
    });

    // Observer for recommended videos
    waitForElement('#secondary-inner ytd-watch-next-secondary-results-renderer #items').then((contents) => {
        otherTitlesLog('Setting up recommended videos observer');
        const recommendedObserver = new MutationObserver(() => {
            refreshOtherTitles();
        });

        recommendedObserver.observe(contents, {
            childList: true
        });
    });

    // Observer for search results
    waitForElement('ytd-section-list-renderer #contents').then((contents) => {
        otherTitlesLog('Setting up search results observer');
        const searchObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && 
                    mutation.addedNodes.length > 0 && 
                    mutation.target instanceof HTMLElement) {
                    const titles = mutation.target.querySelectorAll('#video-title');
                    if (titles.length > 0) {
                        refreshOtherTitles();
                        break;
                    }
                }
            }
        });

        searchObserver.observe(contents, {
            childList: true,
            subtree: true
        });
    });

    // Observer for playlist videos
    waitForElement('#playlist ytd-playlist-panel-renderer #items').then((contents) => {
        otherTitlesLog('Setting up playlist videos observer');
        const playlistObserver = new MutationObserver(() => {
            refreshOtherTitles();
        });

        playlistObserver.observe(contents, {
            childList: true
        });
    });

    // Observer for queue videos
    waitForElement('ytd-playlist-panel-renderer#playlist #items').then((contents) => {
        otherTitlesLog('Setting up queue videos observer');
        const queueObserver = new MutationObserver(() => {
            refreshOtherTitles();
        });

        queueObserver.observe(contents, {
            childList: true
        });
    });
}


// New function to handle search results
async function handleSearchResults(): Promise<void> {
    otherTitlesLog('Processing search results');
    
    // Select all untreated video titles
    const videoTitles = document.querySelectorAll('ytd-video-renderer #video-title:not([translate="no"])') as NodeListOf<HTMLAnchorElement>;
    
    otherTitlesLog('Found video titles:', videoTitles.length);

    for (const titleElement of videoTitles) {
        if (!titleCache.hasElement(titleElement)) {
            otherTitlesLog('Processing search result title:', titleElement.textContent);
            const videoUrl = titleElement.href;
            if (videoUrl) {
                const videoId = new URLSearchParams(new URL(videoUrl).search).get('v');
                if (videoId) {
                    // Check if element has already been processed with this videoId
                    const currentNMT = titleElement.getAttribute('NMT');
                    if (currentNMT === videoId) {
                        otherTitlesLog('Title already processed for video:', videoId);
                        continue;
                    }

                    try {
                        const originalTitle = await titleCache.getOriginalTitle(
                            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}`
                        );
                        updateOtherTitleElement(titleElement, originalTitle, videoId);
                    } catch (error) {
                        otherTitlesLog(`Failed to update search result title:`, error);
                    }
                }
            }
        }
    }
}

function setupUrlObserver() {
    otherTitlesLog('Setting up URL observer');
    
    // Listen for URL changes using History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    // Override pushState
    history.pushState = function(...args) {
        otherTitlesLog('pushState called with:', args);
        originalPushState.apply(this, args);
        handleUrlChange();
    };

    // Override replaceState
    history.replaceState = function(...args) {
        otherTitlesLog('replaceState called with:', args);
        originalReplaceState.apply(this, args);
        handleUrlChange();
    };

    // Listen for popstate event (back/forward browser buttons)
    window.addEventListener('popstate', () => {
        otherTitlesLog('popstate event triggered');
        handleUrlChange();
    });

    // Create an observer for the URL search params
    let lastSearch = window.location.search;
    const observer = new MutationObserver(() => {
        if (window.location.search !== lastSearch) {
            otherTitlesLog('Search params changed:', window.location.search);
            lastSearch = window.location.search;
            handleUrlChange();
        }
    });

    // Observe changes in the document title (YouTube updates it when search changes)
    const titleElement = document.querySelector('title');
    if (titleElement) {
        observer.observe(titleElement, {
            subtree: true,
            characterData: true,
            childList: true
        });
    }
}

function handleUrlChange() {
    otherTitlesLog(`${LOG_PREFIX}[URL] Current pathname:`, window.location.pathname);
    otherTitlesLog(`${LOG_PREFIX}[URL] Full URL:`, window.location.href);
    
    // Check if URL contains @username pattern
    const isChannelPage = window.location.pathname.includes('/@');
    
    if (isChannelPage) {
        // Handle all new channel page types (videos, featured, shorts, etc.)
        refreshOtherTitles();
        return;
    }
    
    switch(window.location.pathname) {
        case '/results':
            console.log(`${LOG_PREFIX}[URL] Detected search page`);
            waitForElement('#contents.ytd-section-list-renderer').then(() => {
                otherTitlesLog('Search results container found');
                handleSearchResults();
            });
            break;
        case '/':  // Home page
        case '/feed/subscriptions':  // Subscriptions page
        case '/feed/trending':  // Trending page
        case '/playlist':  // Playlist page
        case '/channel':  // Channel page (old format)
        case '/watch':  // Video page
        setTimeout(refreshOtherTitles, 200);
        for (let i = 1; i <= 5; i++) {
            setTimeout(refreshOtherTitles, i * 2000);
        }
    }
}