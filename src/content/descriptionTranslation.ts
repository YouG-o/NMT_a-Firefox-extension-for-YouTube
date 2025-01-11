/**
 * NOTE ON SCRIPT INJECTION :
 * We use script injection to access YouTube's description data directly from the page context.
 * This is necessary because ytInitialPlayerResponse is not accessible from the content script context.
 * As you can see down below, the injected code only reads YouTube's data without any modifications.
 */

const DESCRIPTION_LOG_STYLE = 'color: #fca5a5;';
const DESCRIPTION_LOG_CONTEXT = '[Description]';

function descriptionLog(message: string, ...args: any[]) {
    const formattedMessage = `${LOG_PREFIX}${DESCRIPTION_LOG_CONTEXT} ${message}`;
    console.log(`%c${formattedMessage}`, DESCRIPTION_LOG_STYLE, ...args);
}

const DESCRIPTION_SCRIPT = `
(function() {
    const style = '${DESCRIPTION_LOG_STYLE};';
    const prefix = '${LOG_PREFIX}${DESCRIPTION_LOG_CONTEXT}';
    
    console.log('%c' + prefix + ' Injected script starting', style);
    
    // Get current video ID from URL
    const currentVideoId = new URLSearchParams(window.location.search).get('v');
    console.log('%c' + prefix + ' Current video ID:', style, currentVideoId);
    
    // Try to get description from the player API endpoint
    fetch('/youtubei/v1/player?key=' + window.ytcfg.data_.INNERTUBE_API_KEY, {
        method: 'POST',
        body: JSON.stringify({
            videoId: currentVideoId,
            context: {
                client: {
                    clientName: 'WEB',
                    clientVersion: window.ytcfg.data_.INNERTUBE_CLIENT_VERSION
                }
            }
        })
    })
    .then(response => response.json())
    .then(data => {
        // Get description directly from videoDetails
        const description = data?.videoDetails?.shortDescription;
        
        if (description) {
            console.log('%c' + prefix + ' Found description from API for video:', style, currentVideoId);
            window.dispatchEvent(new CustomEvent('nmt-description-data', {
                detail: { description }
            }));
        } else {
            console.log('%c' + prefix + ' No description found in API response');
            window.dispatchEvent(new CustomEvent('nmt-description-data', {
                detail: { description: null }
            }));
        }
    })
    .catch(error => {
        console.log('%c' + prefix + ' Error fetching description:', style, error);
        window.dispatchEvent(new CustomEvent('nmt-description-data', {
            detail: { description: null }
        }));
    });
})();
`;

async function injectDescriptionScript(): Promise<string | null> {
    descriptionLog('Waiting for description element');
    try {
        await waitForElement('#description-inline-expander');
        descriptionLog('Description element found, injecting script');
        
        // Try up to 3 times to get the description
        for (let i = 0; i < 3; i++) {
            const description = await new Promise<string | null>((resolve) => {
                const handleDescription = (event: CustomEvent) => {
                    window.removeEventListener('nmt-description-data', handleDescription as EventListener);
                    resolve(event.detail?.description || null);
                };

                window.addEventListener('nmt-description-data', handleDescription as EventListener);
                
                const script = document.createElement('script');
                script.textContent = DESCRIPTION_SCRIPT;
                const target = document.head || document.documentElement;
                target?.appendChild(script);
                script.remove();
            });

            if (description) {
                return description;
            }

            // Wait a bit before retrying
            if (i < 2) {
                descriptionLog('Retrying to get description...');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        return null;
    } catch (error) {
        console.error(`${LOG_PREFIX}${DESCRIPTION_LOG_CONTEXT} ${error}`);
        return null;
    }
}

class DescriptionCache {
    private processedElements = new WeakMap<HTMLElement, string>();

    hasElement(element: HTMLElement): boolean {
        return this.processedElements.has(element);
    }

    setElement(element: HTMLElement, description: string): void {
        descriptionLog('Caching element with description');
        this.processedElements.set(element, description);
    }

    async getOriginalDescription(): Promise<string | null> {
        return injectDescriptionScript();
    }
}

const descriptionCache = new DescriptionCache();

function setupDescriptionObserver() {
    // Observer for video changes via URL
    waitForElement('ytd-watch-flexy').then((watchFlexy) => {
        descriptionLog('Setting up video-id observer');
        const observer = new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'video-id') {
                    descriptionLog('Video ID changed!');
                    // Wait a bit for YouTube to update its data
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    // Then wait for description element
                    await waitForElement('#description-inline-expander');
                    browser.storage.local.get('settings').then(async (data: Record<string, any>) => {
                        const settings = data.settings as ExtensionSettings;
                        if (settings?.descriptionTranslation) {
                            descriptionLog('Fetching new description');
                            const description = await injectDescriptionScript();
                            if (description) {
                                descriptionLog('Got new description:', description);
                                const descriptionElement = document.querySelector('#description-inline-expander') as HTMLElement;
                                updateDescriptionElement(descriptionElement, description);
                            } else {
                                descriptionLog('Failed to get new description');
                            }
                        }
                    });
                }
            }
        });

        observer.observe(watchFlexy, {
            attributes: true,
            attributeFilter: ['video-id']
        });
    });

    // Observer for description expansion/collapse
    waitForElement('#description-inline-expander').then((descriptionElement) => {
        descriptionLog('Setting up expand/collapse observer');
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'is-expanded') {
                    descriptionLog('Description expanded/collapsed');
                    browser.storage.local.get('settings').then(async (data: Record<string, any>) => {
                        const settings = data.settings as ExtensionSettings;
                        if (settings?.descriptionTranslation) {
                            const description = await injectDescriptionScript();
                            if (description) {
                                updateDescriptionElement(descriptionElement as HTMLElement, description);
                            }
                        }
                    });
                }
            }
        });

        observer.observe(descriptionElement, {
            attributes: true,
            attributeFilter: ['is-expanded']
        });
    });
}

async function refreshDescription(): Promise<void> {
    const data = await browser.storage.local.get('settings');
    const settings = data.settings as ExtensionSettings;
    if (!settings?.descriptionTranslation) return;

    const descriptionElement = document.querySelector('#description-inline-expander') as HTMLElement;
    if (descriptionElement && !descriptionCache.hasElement(descriptionElement)) {
        descriptionLog('Processing description element');
        const originalDescription = await descriptionCache.getOriginalDescription();
        
        if (originalDescription) {
            descriptionLog('Found original description:', originalDescription);
            updateDescriptionElement(descriptionElement, originalDescription);
        } else {
            console.error(`${LOG_PREFIX}${DESCRIPTION_LOG_CONTEXT} No original description found`);
        }
    }
}


function updateDescriptionElement(element: HTMLElement, description: string): void {
    descriptionLog('Updating element with description');
    
    // Find the text containers
    const attributedString = element.querySelector('yt-attributed-string');
    const snippetAttributedString = element.querySelector('#attributed-snippet-text');
    
    if (!attributedString && !snippetAttributedString) {
        console.error(`${LOG_PREFIX}${DESCRIPTION_LOG_CONTEXT} No description text container found`);
        return;
    }

    // Create the text content
    const span = document.createElement('span');
    span.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-pre-wrap';
    span.dir = 'auto';
    
    // URL regex pattern
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    
    const lines = description.split('\n');
    lines.forEach((line, index) => {
        // Split the line by URLs and create elements accordingly
        const parts = line.split(urlPattern);
        parts.forEach((part, partIndex) => {
            if (part.match(urlPattern)) {
                // This is a URL, create a link
                const link = document.createElement('a');
                link.href = part;
                link.textContent = part;
                link.className = 'yt-core-attributed-string__link yt-core-attributed-string__link--call-to-action-color';
                link.setAttribute('target', '_blank');
                link.style.color = 'rgb(62, 166, 255)';
                span.appendChild(link);
            } else if (part) {
                // This is regular text
                span.appendChild(document.createTextNode(part));
            }
        });

        if (index < lines.length - 1) {
            span.appendChild(document.createElement('br'));
        }
    });

    // Update both containers if they exist
    if (attributedString) {
        while (attributedString.firstChild) {
            attributedString.removeChild(attributedString.firstChild);
        }
        attributedString.appendChild(span.cloneNode(true));
    }
    
    if (snippetAttributedString) {
        while (snippetAttributedString.firstChild) {
            snippetAttributedString.removeChild(snippetAttributedString.firstChild);
        }
        snippetAttributedString.appendChild(span.cloneNode(true));
    }

    // Prevent translation on all levels
    [element, attributedString, snippetAttributedString].forEach(el => {
        if (el) {
            el.setAttribute('translate', 'no');
            if (el instanceof HTMLElement) {
                el.style.setProperty('translate', 'no', 'important');
            }
        }
    });
    
    descriptionCache.setElement(element, description);
}


function initializeDescriptionTranslation() {
    descriptionLog('Initializing description translation prevention');

    browser.storage.local.get('settings').then((data: Record<string, any>) => {
        const settings = data.settings as ExtensionSettings;
        if (settings?.descriptionTranslation) {
            refreshDescription();
        }
    });

    browser.runtime.onMessage.addListener((message: unknown) => {
        if (isToggleMessage(message) && message.feature === 'description') {
            if (message.isEnabled) {
                refreshDescription();
            }
        }
        return true;
    });
}