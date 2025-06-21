!function(m,L,E,A,R,N,_){
    if(N[L]) return;
    if(!m.querySelector("video")) {
        R("Cannot find video element. Maybe you forgot to select the video element in the DevTools?");
        return;
    };
    function a(s,w){
        const e = m.createElement('script');
        e.src = s;
        e.type = 'text/javascript';
        w.appendChild(e);
    }
    a("https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js",m.head);
    a(_+"settings.js",m.body);
    setTimeout(()=>{
        if(!N.lS) {
            R(A(E));
            alert(A(E));
            return;
        }
        a(_+"core.js",m.body);
        N[L] = true;
    },1000);
}(document, "mLearnOnlineAgentLoaded", "bUxlYXJuIGRpZCBub3QgbG9hZCBwcm9wZXJseS4gUGxlYXNlIGNoZWNrIGlmIHRoZSBhcHBsaWNhdGlvbiBsb2FkZWQgc3VjY2Vzc2Z1bGx5IGFuZCBpcyBydW5uaW5nLiBJZiB0aGUgcHJvYmxlbSBwZXJzaXN0cywgdHJ5IHJlbG9hZGluZyB0aGUgcGFnZSBhbmQgdHJ5aW5nIGFnYWluLiBJZiB0aGUgcHJvYmxlbSBzdGlsbCBwZXJzaXN0cywgcGxlYXNlIHJlc3RhcnQgbUxlYXJuLg==", atob, console.error, window, "http://localhost:7753/");