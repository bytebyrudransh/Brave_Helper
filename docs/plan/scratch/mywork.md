                                                                                                     
  What just changed                                                                                  
                                                                                                     
  - Stale indicator: side panel now subscribes to chrome.tabs.onActivated / onUpdated and tracks the 
  active tab URL. When it differs from page.url, a stale badge appears next to the page title and the
   recapture link turns warning-coloured. Hover the badge to see captured-vs-current URLs.           
  - Old plan banners: v1, v1.5, v1.5-lean, and  plan_from_yt.md all carry a "Superseded" header      
  pointing at v1.6 brave-extension plan.md.                                                          
                                                                                                     
  What's left (your side)                                                                            
                                                                                                   
  1. Manual smoke test in real Brave — load dist/, verify the eight flows you listed.                
  2. Tighten OLLAMA_ORIGINS to your exact extension ID once Brave assigns one (look on             
  brave://extensions after loading).                                                                 
  3. Commit when smoke passes.                                                                     
                                                                                                     
  Want me to do the focused review?                                                                
                                                                                                     
  I can do a tight pre-commit pass over the V1.6 surface (manifest scopes, side-panel error paths,   
  content-script edge cases like chrome:///PDF/iframes that won't have the script injected, prompt
  construction) and flag anything that would bite during the smoke test. Say "yes review" and I'll do
   it without touching code; I'll come back with a punch-list. Otherwise this is a clean stopping  
  point to commit from.
  



  ● Both diagnoses are correct, and that's exactly what you'd expect on a first load. Two small
  additions worth knowing:                                                                     
                      
  On the 403 / OLLAMA_ORIGINS=*: that works, but on Linux with systemd the cleaner path once   
  you know the extension ID is to scope it down — pin it to your specific extension. From      
  brave://extensions copy the ID (e.g. abcdefghi...) and set:                                  
                                                                                               
  Environment="OLLAMA_ORIGINS=chrome-extension://abcdefghi..."                                 

  * is fine for now — just don't leave it that way long-term, since any page in any browser    
  becomes able to hit your local Ollama.
                                                                                               
  On the "Receiving end does not exist": refreshing fixes it for normal pages, but content     
  scripts never inject on these URLs no matter what:
  - chrome://*, brave://*, chrome-extension://*                                                
  - view-source:*                                           
  - Chrome Web Store / Brave's internal pages
  - new-tab page in some builds                                                                
  - some PDF viewers           
                                                                                               
  So if you click the extension on brave://settings or a fresh new-tab, you'll always see that 
  error. That's a feature of MV3, not a bug — it's why <all_urls> in host_permissions doesn't  
  actually mean "all URLs."                                                                    
                                                                                               
  Want me to make this less ugly? Right now the side panel shows the raw                       
  chrome.tabs.sendMessage error string. I can:
  1. Detect "Receiving end does not exist" → show: "This page hasn't loaded the helper yet —   
  refresh the tab, or this is a browser-internal page where extensions can't read."            
  2. Detect 403 from Ollama → show: "Ollama rejected the extension origin. Set     
  OLLAMA_ORIGINS=chrome-extension://<id> and restart ollama serve."                            
  3. Detect Failed to fetch → show: "Ollama isn't reachable at localhost:11434."               
                                                                                
  That turns the smoke-test errors into self-explaining banners. Five-minute change, no        
  architecture impact. Say "do it" and I will; otherwise I'll leave it.                        
                                                                          