import { DOMSubscriber } from "https://cdn.pagelove.net/js/dom-subscriber/cde4007/index.mjs";

function generateSelector( ) {
    try {
        // If element has an ID, use it as the selector for stability
        if (this.id) {
            return `#${CSS.escape(this.id)}`;
        }

        // Otherwise, build a path from the nearest parent with an ID
        let el = this;
        let path = [];
        let parent;

        while ((parent = el.parentNode)) {
            // Check if parent is a valid element node
            if (parent.nodeType !== Node.ELEMENT_NODE && parent !== document) {
                break;
            }
            
            // If parent has an ID, we'd rather start our selector from there
            if (parent.id) {
                const index = parent.children ? [].indexOf.call(parent.children, el) + 1 : 1;
                path.unshift(
                    `#${CSS.escape(parent.id)} > ${el.tagName}:nth-child(${index})`
                );
                return path.join(" > ").toLowerCase();
            }

            const index = parent.children ? [].indexOf.call(parent.children, el) + 1 : 1;
            path.unshift(
                `${el.tagName}:nth-child(${index})`
            );
            el = parent;
        }

        return `${path.join(" > ")}`.toLowerCase();
    } catch (error) {
        console.error('Pagelove primitives: Failed to generate selector:', error);
        // Return a fallback selector
        return `${this.tagName || 'unknown'}`.toLowerCase();
    }
}

function htmlToNode(html) {
    try {
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        const nNodes = template.content.childNodes.length;
        if (nNodes !== 1) {
            throw new Error(`html parameter must represent a single node; got ${nNodes}.`);
        }
        return template.content.firstChild;
    } catch (error) {
        console.error('DOM-aware primitives: Failed to parse HTML:', error);
        throw error;
    }
}

class MultipartBody {
    constructor( rawBody, boundary ) {
        this.parts = [];
        const delimiter = `--${boundary}`;
        const sections = rawBody.split( delimiter ).filter( section => section.trim() && section.trim() !== '--' );
        for ( const section of sections ) {
            const [ rawHeaders, ...bodyLines ] = section.split( '\r\n\r\n' );
            const headers = {};
            for ( const line of rawHeaders.trim().split( '\r\n' ) ) {
                const [ key, value ] = line.split( ': ' );
                headers[ key.toLowerCase() ] = value;
            }
            const body = bodyLines.join( '\r\n\r\n' ).trim();
            this.parts.push({ headers, body });
        }
    }
}

class MultipartMessage {
        constructor( message ) {
            if (!message.ok) throw new Error('HTTP Message not ok (status outside of 400-499 range)');
            if (!this.constructor.isMultipart( message )) throw new Error( 'HTTP Message is not multi-part');

            this.message = message;
        }

        get parts() {
            return (async() => {
                const text = await this.body;
                const body = new MultipartBody( text, this.boundary );
                return body.parts;
             })();
        }

        get body() {
            if ( this.bodyText ) {
                return (async() =>{ return this.bodyText })();
            } else {
                return (async () => {
                    const bodyText = await this.message.text();
                    this.bodyText = bodyText;
                    return this.bodyText;
                })();
            }
        }

        get boundary() {
            const contentType = this.message.headers.get( 'Content-Type' ) || '';
            const boundary = contentType.match(/boundary=(.+)$/);
            return boundary[1];
        }

        static isMultipart( message ) {
            const contentType = message.headers.get( 'Content-Type' ) || '';
            if ( contentType ) return !!contentType.match(/boundary=(.+)$/);
            return false;
        }
}

async function OPTIONS( aPLDocument ) {
    const message = new MultipartMessage( await fetch( aPLDocument.url, {
        method: 'OPTIONS',
        headers: {
            'Prefer': 'return=representation',
            'Accept': 'multipart/mixed'    
        }
    }) );
    if ( message ) {
        const parts = await message.parts;
        for ( const part of parts ) {
            if ( part.headers['content-range'] ) {
                const selector = part.headers['content-range'].split(/=/)[1];                
                const doc = await aPLDocument.document;
                DOMSubscriber.subscribe( doc, selector, (node) => {
                    const anEvent = new CustomEvent('PLCapability', {
                        detail: {
                            selector: selector,
                            allow: part.headers['allow'].split(',').map( method => method.trim() )
                        },
                        bubbles: true,
                        composed: true,
                        cancelable: true
                    });
                    node.dispatchEvent( anEvent );
                });
            }
        }
    }
}

class PLElement {
    #document; #element;

    constructor( url, element ) {
        this.url = url;

        if ( element ) {
            this.element = element;
        }

        Object.defineProperty(this, 'selector', {
            get: generateSelector.bind(this.#element),
            enumerable: true,
            configurable: true
        });
    }

    get element () {
        return this.#element;
    }

    set element( aVal ) {
        this.#element = aVal;
        this.document = aVal.ownerDocument;
    }

    get document() {
        return this.#document;
    }

    set document( aVal ) {
        this.#document = aVal;
    }

    req( method, opts) {
        const details = {
            method,
            headers: {
                Range: `selector=${this.selector}`
            },
            ...opts
        };
        return new Request( this.url, details );
    }


    async #processRequest( request ) {
        const response = await fetch( request );
        this.element.dispatchEvent( new CustomEvent( 'PLMethodCompleted', {
            detail: {
                method: 'PUT',
                response
            },
            bubbles: true,
            composed: true,
            cancelable: true
        }))
        return response;
    }

    async DELETE() {
        const response = this.#processRequest( this.req('DELETE') );
        if ( response.ok ) this.element.remove();
        else {
            console.log(`DELETE request failed with status ${response.status}`);
        }
        return response;
    }

    async POST( body ) {
        if (!body) throw new Error(`POST requires a body paramter`);
        else if (body instanceof Node) body = body.outerHTML;
        const response = await this.#processRequest( this.req('POST', { body }) );
        if ( response.ok ) {
            const responseText = await response.text();
            this.#element.appendChild( htmlToNode( responseText ) );
            return new Response( responseText, response );
        }
        return response;
    }

    async PUT( body ) {
        if ( !body ) body = this.element.outerHTML;
        else if ( body instanceof Node ) body = body.outerHTML;
        return this.#processRequest( this.req('PUT', { body }) );
    }    
}


class PLDocument {
    #document;

    constructor( url ) {
        if (!url) url = window.location.href;
        this.url = url;        

        if ( this.url === window.location.href ) {
            this.document = window.document;
        }

        return this;        
    }
    
    set document( aVal ) {
        this.#document = aVal;        
        this.#document.pagelove = new WeakRef( this )

        this.#document.addEventListener( 'PLCapability', async ( event ) => {
            for ( const method of event.detail.allow ) {        
                const element = await this.createElement( event.target );        
                Object.defineProperty( event.target, method.toUpperCase(), {
                    value: element[ method ].bind( element ),
                    writable: false,
                    enumerable: true,
                    configurable: true
                });
            }
        });
        
        this.#document.addEventListener('PLMethodCompleted', async (event) => {
            const response = event.detail.response;
            if ( !response.ok ) {
                console.error(`PLMethod ${event.detail.method} failed with status ${event.detail.response.status}`);
            }
        });

    }

    get document() {
        if (!this.#document ) {
            return (async () => {
                const response = await fetch( this.url );
                const text = await response.text();
                const parser = new DOMParser();
                this.#document = parser.parseFromString( text, 'text/html' );
                return this.#document;
            })();
        }

        return (async () => {
            return this.#document;
        })();
    }    

    async createElement( element ) {
        return new PLElement( this.url, element );
    }

    req( method, ...opts) {
        return new Request( this.url, {
            method,
            headers: {},
            ...opts
        });
    }

    async OPTIONS() {
        return OPTIONS( this );
    }
}



export { PLDocument, PLElement };