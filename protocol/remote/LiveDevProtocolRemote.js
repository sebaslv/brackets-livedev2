/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint browser: true, vars: true, plusplus: true, devel: true, nomen: true, indent: 4, forin: true, maxerr: 50, regexp: true, evil: true */

// This is the script that Brackets live development injects into HTML pages in order to
// establish and maintain the live development socket connection. Note that Brackets may
// also inject other scripts via "evaluate" once this has connected back to Brackets.

(function (global) {
    "use strict";
    
    // This protocol handler assumes that there is also an injected transport script that
    // has the following methods:
    //     setCallbacks(obj) - a method that takes an object with a "message" callback that
    //         will be called with the message string whenever a message is received by the transport.
    //     send(msgStr) - sends the given message string over the transport.
    var transport = global._Brackets_LiveDev_Transport;
    
    var MessageBroker = {
                
        _handlers: {},
        
        message: function (msg) {
            if (this._handlers.hasOwnProperty(msg.method)) {
                this._handlers[msg.method].forEach(function (handler) {
                    handler(msg);
                });
            }
        },
        
        respond: function (orig, response) {
            response.id = orig.id;
            transport.send(JSON.stringify(response));
        },
        
        on: function (method, handler) {
            if (!this._handlers[method]) {
                this._handlers[method] = [];
            }
            this._handlers[method].push(handler);
        },
        
        send: function (msgStr) {
            transport.send(JSON.stringify(msgStr));
        }
    };
    
    // TODO: Split remote commands in different files once we get a more complete idea of what we need.
    
    /**
     * Common functions.
     */
    var Utils = {
        
        isExternalStylesheet: function (node) {
            return (node.nodeName.toUpperCase() === "LINK" && node.rel === "stylesheet" && node.href);
        },
        isExternalScript: function (node) {
            return (node.nodeName.toUpperCase() === "SCRIPT" && node.src);
        }
    };
    
    /**
     * CSS related commands and notifications
     */
    var CSS = {
        
            /**
            * Maintains a map of stylesheets loaded thorugh @import rules and their parents.
            * Populated by extractImports, consumed by notifyImportsAdded / notifyImportsRemoved.
            * @type {
            */
            imports : {},
        
            /** 
             * Extract all the stylesheets for this parent by recursively
             * scanning CSSImportRules and push them to this.imports:
             *    imports[href] = [imp-href-1, imp-href-2, ...] urls of import-ed stylesheets, being href the url of the parent Stylesheet.
             * @param {Object:CSSStylesheet} stylesheet
             */
            extractImports : function (styleSheet) {
                var i,
                    parent,
                    rules = styleSheet.cssRules;
                if (!rules) {
                    return;
                }
                for (i = 0; i < rules.length; i++) {
                    if (rules[i].href) {
                        parent = rules[i].parentStyleSheet;
                        // initialize array 
                        if (!this.imports[parent.href]) {
                            this.imports[parent.href] = [];
                        }
                        // extract absolute url
                        this.imports[parent.href].push(rules[i].styleSheet.href);
                        // recursive
                        this.extractImports(rules[i].styleSheet);
                    }
                }
            },

            /**
             * Iterates on imports map and send a Stylesheet.Added notification per each 
             * import-ed stylesheet.
             * @param  {string} href Absolute URL of the stylesheet.
             */
            notifyImportsAdded : function (href) {
                var self = this;
                if (!this.imports[href]) {
                    return;
                }
                this.imports[href].forEach(function (impHref) {
                    MessageBroker.send({
                        method: "Stylesheet.Added",
                        href: impHref,
                        parentStylesheet: href
                    });
                    // recursive
                    self.notifyImportsAdded(impHref);
                });
            },

            /**
             * Sends a notification for the added stylesheet and drives the process 
             * that extracts @import rules and sends notifications for them.
             * @param  {string} href Absolute URL of the stylesheet.
             */
            notifyStylesheetAdded : function (href) {
                var self = this;
                // notify stylesheet added
                MessageBroker.send({
                    method: "Stylesheet.Added",
                    href: href
                });

                // Inspect CSSRules for @imports:
                // styleSheet obejct is required to scan CSSImportRules but
                // browsers differ on the implementation of MutationObserver interface.
                // Webkit triggers notifications before stylesheets are loaded, 
                // Firefox does it after loading.
                // There are also differences on when 'load' event is triggered for 
                // the 'link' nodes. Webkit triggers it before stylesheet is loaded.
                // Some references to check:
                //      http://www.phpied.com/when-is-a-stylesheet-really-loaded/
                //      http://stackoverflow.com/questions/17747616/webkit-dynamically-created-stylesheet-when-does-it-really-load
                //        http://stackoverflow.com/questions/11425209/are-dom-mutation-observers-slower-than-dom-mutation-events      
                //
                // TODO: This is just a temporary 'cross-browser' solution, it needs optimization.
                var loadInterval = setInterval(function () {
                    var i;
                    for (i = 0; i < document.styleSheets.length; i++) {
                        if (document.styleSheets[i].href === href) {
                            //clear interval
                            clearInterval(loadInterval);
                            //build imports map, extract imports to _imports[href]
                            self.extractImports(document.styleSheets[i]);
                            //notify imports
                            self.notifyImportsAdded(href);
                            break;
                        }
                    }
                }, 50);
            },

            /**
             * Iterates (recursively) on imports map and send a Stylesheet.Removed 
             * notification per each import-ed stylesheet taking href as the root parent.
             * @param  {string} href Absolute URL of the stylesheet.
             */
            notifyImportsRemoved : function (href) {
                var self = this;
                if (!this.imports[href]) {
                    return;
                }
                this.imports[href].forEach(function (impHref) {
                    MessageBroker.send({
                        method: "Stylesheet.Removed",
                        href: impHref,
                        parentStylesheet: href
                    });
                    // recursive
                    return self.notifyImportsRemoved(impHref);
                });
                // remove entry from imports
                delete this.imports[href];
            },
        
            /**
             * Sends a notification for the removed stylesheet and  
             * its import-ed styleshets.
             * @param  {string} href Absolute URL of the stylesheet.
             */
            notifyStylesheetRemoved : function (href) {
                var i;
                
                // notify stylesheet removed
                MessageBroker.send({
                    method: "Stylesheet.Removed",
                    href: href
                });
                this.notifyImportsRemoved(href);
            }
        };
    
    var DocumentObserver = {
        
        /* init hook. */
        start:  function () {
            //start listening to node changes
            this._enableListeners();
            //send the current status of related docs. 
            MessageBroker.send({
                method: "Document.Related",
                related: this.related()
            });
        },
        
        /*  Retrieves related documents (external CSS and JS files) */
        related: function () {
            var related = {
                scripts: {},
                stylesheets: {}
            };
            var i;
            //iterate on document scripts (HTMLCollection doesn't provide forEach iterator).
            for (i = 0; i < document.scripts.length; i++) {
                //add only external scripts
                if (document.scripts[i].src) {
                    related.scripts[document.scripts[i].src] = true;
                }
            }
          
            var s, j;
            //traverse @import rules
            var traverseRules = function _traverseRules(sheet, base) {
                var i;
                if (sheet.href && sheet.cssRules) {
                    if (related.stylesheets[sheet.href] === undefined) {
                        related.stylesheets[sheet.href] = [];
                    }
                    related.stylesheets[sheet.href].push(base);
                    for (i = 0; i < sheet.cssRules.length; i++) {
                        if (sheet.cssRules[i].href) {
                            traverseRules(sheet.cssRules[i].styleSheet, base);
                        }
                    }
                }
            };
            //iterate on document.stylesheets (StyleSheetList doesn't provide forEach iterator).
            for (j = 0; j < document.styleSheets.length; j++) {
                s = document.styleSheets[j];
                traverseRules(s, s.href);
            }
            return related;
        },
        
        _enableListeners: function () {
            var self = this;
            // enable MutationOberver if it's supported
            var MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;
            if (MutationObserver) {
                var observer = new MutationObserver(function (mutations) {
                    mutations.forEach(function (mutation) {
                        if (mutation.addedNodes.length > 0) {
                            self._onNodesAdded(mutation.addedNodes);
                        }
                        if (mutation.removedNodes.length > 0) {
                            self._onNodesRemoved(mutation.removedNodes);
                        }
                    });
                });
                observer.observe(document, {
                    childList: true,
                    subtree: true
                });

            } else {
                // use MutationEvents as fallback 
                document.addEventListener('DOMNodeInserted', function niLstnr(e) {
                    self._onNodesAdded([e.target]);
                });
                document.addEventListener('DOMNodeRemoved', function nrLstnr(e) {
                    self._onNodesRemoved([e.target]);
                });
            }
        },

        /* process related docs added */
        _onNodesAdded: function (nodes) {
            var i,
                self = this;
            for (i = 0; i < nodes.length; i++) {
                //check for Javascript files
                if (Utils.isExternalScript(nodes[i])) {
                    MessageBroker.send({
                        method: 'Script.Added',
                        src: nodes[i].src
                    });
                }
                //check for stylesheets
                if (Utils.isExternalStylesheet(nodes[i])) {
                    CSS.notifyStylesheetAdded(nodes[i].href);
                }
            }
        },
        /* process related docs removed */
        _onNodesRemoved: function (nodes) {
            var i;
            //iterate on removed nodes
            for (i = 0; i < nodes.length; i++) {
                
                // check for external JS files
                if (Utils.isExternalScript(nodes[i])) {
                    MessageBroker.send({
                        method: 'Script.Removed',
                        src: nodes[i].src
                    });
                }
                //check for external StyleSheets
                if (Utils.isExternalStylesheet(nodes[i])) {
                    CSS.notifyStylesheetRemoved(nodes[i].href);
                }
            }
        },
        
        stop: function () {}
    };

    /*
    * Page Domain
    */
    var Page = {
        enable: function (msg) {
            DocumentObserver.start();
        },
        reload: function (msg) {
            window.location.reload(msg.ignoreCache);
        }
    };
        
    // subscribe handlers to methods
    MessageBroker.on("Page.enable", Page.enable);
    MessageBroker.on("Page.reload", Page.reload);
    
        
    /*
    * Runtime Domain
    */
    var Runtime = {
        evaluate: function (msg) {
            console.log("Runtime.evaluate");
            var result = eval(msg.params.expression);
            console.log("result: " + result);
            MessageBroker.respond(msg, {
                result: JSON.stringify(result) // TODO: in original protocol this is an object handle
            });
        }
    };
    
    // subscribe handlers to methods
    MessageBroker.on("Runtime.evaluate", Runtime.evaluate);
    
        
    /**
     * The remote handler for the protocol.
     */
    var ProtocolHandler = {
        /**
         * Handles a message from the transport. Parses it as JSON and delegates
         * to MessageBroker who is in charge of routing them to subscribers.
         * @param {msgStr} string The protocol message as stringified JSON.
         */
        message: function (msgStr) {
            console.log("received: " + msgStr);
            var msg = JSON.parse(msgStr);
            MessageBroker.message(msg);
        }
    };
    
    // By the time this executes, there must already be an active transport.
    if (!transport) {
        console.error("[Brackets LiveDev] No transport set");
        return;
    }
    
    transport.setCallbacks(ProtocolHandler);
    
}(this));
