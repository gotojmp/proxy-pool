/**
 * proxy pool
 *
 * 1. pool for a huge amount of proxy ip
 * 2. quality test for each proxy
 * 3. use rate control for each proxy
 */

var redis = require('redis');
var Crawler = require('node-webcrawler');


/**
 * redis structure
 * pp:ip:inbox
 * pp:ip:fast
 * pp:ip:usable
 * pp:ip:trash
 * pp:ip:
 * pp:ip:
 * pp:ip:
 */
var DBK = {
    inbox: 'pp:ip:inbox', // zset
    fast: 'pp:ip:fast',
    usable: 'pp:ip:usable'
};

var RegexProxy = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}/;

function openRedis () {
    return redis.createClient({
        host: '127.0.0.1',
        port: '1998'
    });
}

setTimeout(function () {
    // recheck();
    check();
    grabber();
}, 100);

function proxyChecker () {
    return new Crawler({
        // debug: true,
        // logger: console,
        maxConnections: 20,
        timeout: 15000,
        retries: 2,
        retryTimeout: 3000,
        forceUTF8: true,
        json: true,
        jQuery: false
    });
}

var c = proxyChecker();
var checkProxy = function (proxy, cb) {
    console.log('start check', proxy);
    var ua = 'i am a user agent.';
    c.queue({
        uri: 'http://www.99jun.cn/proxy.php',
        method: 'POST',
        json: true,
        headers: {
            'User-Agent': ua
        },
        form: {
            ua: ua
        },
        proxy: 'http://' + proxy,
        callback: function (err, res) {
            if (!err && res.statusCode == '200') {
                var body = res.body;
                // console.log(res.body)
                if (body && body.ua == ua && body.data == ua) {
                    if (body.proxy == '' || body.proxy == body.ip) {
                        console.log('===', proxy, 'ok');
                        return cb && cb(proxy);
                    }
                }
            }
            console.log('***', proxy, 'no');
        }
    });
};

var check = function () {
    var client = openRedis();
    client.scard(DBK.usable, function (err, res) {
        console.log('usable:', res);
    });
    client.zrangebyscore(DBK.inbox, [0, '+inf', 'WITHSCORES', 'LIMIT', 0, 10], function (err, res) {
        if (res && res.length) {
            var args = [];
            for (var i = 0; i < res.length; i += 2) {
                var proxy = res[i];
                var t = res[i+1];
                checkProxy(proxy, proxy => pushUsable(proxy));
                args.push(-t, proxy);
            }
            client.zadd(DBK.inbox, args, () => client.quit());
        } else {
            client.quit();
        }
    });
    setTimeout(check, 5000);
};

var recheck = function () {
    var client = openRedis();
    client.smembers(DBK.usable, function (err, res) {
        if (res && res.length) {
            var n = 0;
            res.forEach(proxy => checkProxy(proxy, () => {
                console.log(++n);
            }));
        }
        client.quit();
    });
};

function time () {
    return Math.floor(new Date().getTime() / 1000);
}

var pushInbox = function (proxies) {
    var client = openRedis();
    var t = time();
    var args = ['NX'];
    proxies.forEach(proxy => args.push(t, proxy));
    client.zadd(DBK.inbox, args, function (err, res) {
        console.log('grabbed +', res);
        client.quit();
    });
};

var pushUsable = function (proxies) {
    var client = openRedis();
    client.sadd(DBK.usable, proxies, function (err, res) {
        console.log('usable +', res);
        client.quit();
    });
};

var pushFast = function (proxies) {
    var client = openRedis();
    client.sadd(DBK.fast, proxies, function (err, res) {
        console.log('fast +', res);
        client.quit();
    });
};

var grabber = function () {
    var c = new Crawler({
        // debug: true,
        // logger: console,
        maxConnections: 10,
        timeout: 15000,
        retries: 2,
        retryTimeout: 3000,
        forceUTF8: true,
        rateLimits: 500,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36'
        },
        callback: function (err, res, $) {
            if (err) {
                console.log(err);
            } else if (res.statusCode == '200' && $) {
                var proxies = [];
                if (res.request.href.indexOf('kuaidaili') > -1) {
                    $('#list table tbody tr').each(function () {
                        var self = $(this);
                        var ip = self.find('td[data-title=IP]').html();
                        var port = self.find('td[data-title=PORT]').html();
                        var proxy = ip + ':' + port;
                        if (RegexProxy.test(proxy)) {
                            proxies.push(proxy);
                        }
                    });
                } else if (res.request.href.indexOf('xicidaili') > -1) {
                    $('#ip_list tr').each(function () {
                        var self = $(this);
                        var c = self.find('td.country');
                        if (!c) return;
                        var ip = c.next().html();
                        var port = c.next().next().html();
                        var proxy = ip + ':' + port;
                        if (RegexProxy.test(proxy)) {
                            proxies.push(proxy);
                        }
                    });
                } else if (res.request.href.indexOf('goubanjia') > -1) {
                    $('#list table tbody tr').each(function () {
                        var self = $(this);
                        var ip = self.find('td.ip').html();
                        ip = ip.replace(/(<[^>]*><\/[^>]*>|<[^>]*style="display:\s*none;">[^<]*<\/[^>]*>)/ig, '').replace(/<[^>]*>/ig, '');
                        var port = self.find('td.port').html();
                        var proxy = ip + ':' + port;
                        if (RegexProxy.test(proxy)) {
                            proxies.push(proxy);
                        }
                    });
                }
                proxies.length && pushInbox(proxies);
            }
        }
    });
    // var fs = require('fs');
    // fs.readFile('ip.txt', function (err, res) {
    //     if (res) {
    //         var proxies = [];
    //         var ips = res.toString().split('\n');
    //         if (ips && ips.length) {
    //             ips.forEach(proxy => RegexProxy.test(proxy) && proxies.push(proxy.trim()));
    //         }
    //         proxies.length && pushInbox(proxies);
    //     }
    // });
    c.queue({
        uri: 'http://api.goubanjia.com/api/get.shtml?order=b671d0f7bcd92f6d58db7643018f5094&num=1000&area=%E4%B8%AD%E5%9B%BD&carrier=0&protocol=0&an1=1&sp1=1&sp2=2&sp3=3&sort=1&system=1&distinct=0&rettype=0&seprator=%0A',
        json: true,
        callback: (err, res) => {
            if (res && res.body && res.body.success) {
                var ips = res.body.data;
                var proxies = [];
                ips.forEach(item => proxies.push(item.ip+':'+item.port));
                proxies.length && pushInbox(proxies);
            }
        }
    });
    c.queue({
        uri: 'http://api.zdaye.com/?api=201609211604193697&dengji=%B8%DF%C4%E4&sleep=10%C3%EB%C4%DA&gb=2&ct=100',
        callback: (err, res) => {
            if (res && res.body) {
                // console.log(res.body);
                var proxies = [];
                var ips = res.body.split('\n');
                if (ips && ips.length) {
                    ips.forEach(proxy => RegexProxy.test(proxy) && proxies.push(proxy.trim()));
                }
                proxies.length && pushInbox(proxies);
            }
        }
    });
    c.queue({
        uri: 'http://dev.kuaidaili.com/api/getproxy/?orderid=997445085294546&num=100&area=%E5%A4%A7%E9%99%86&b_pcchrome=1&b_pcie=1&b_pcff=1&b_android=1&b_iphone=1&b_ipad=1&protocol=1&method=2&an_an=1&an_ha=1&dedup=1&sep=2',
        callback: (err, res) => {
            if (res && res.body) {
                // console.log(res.body);
                var proxies = [];
                var ips = res.body.split('\n');
                if (ips && ips.length) {
                    ips.forEach(proxy => RegexProxy.test(proxy) && proxies.push(proxy.trim()));
                }
                proxies.length && pushInbox(proxies);
            }
        }
    });
    // c.queue({
    //     uri: 'http://www.goubanjia.com/free/gngn/index.shtml',
    //     cookie: 'auth=ba768fc347de4a875888587d4d3257e8'
    // });
    // c.queue([
    //     'http://www.kuaidaili.com/free/inha/20',
    //     'http://www.kuaidaili.com/free/inha/19',
    //     'http://www.kuaidaili.com/free/inha/18',
    //     'http://www.kuaidaili.com/free/inha/17',
    //     'http://www.kuaidaili.com/free/inha/16',
    //     'http://www.kuaidaili.com/free/inha/15',
    //     'http://www.kuaidaili.com/free/inha/14',
    //     'http://www.kuaidaili.com/free/inha/13',
    //     'http://www.kuaidaili.com/free/inha/12',
    //     'http://www.kuaidaili.com/free/inha/11',
    //     'http://www.kuaidaili.com/free/inha/10',
    //     'http://www.kuaidaili.com/free/inha/9',
    //     'http://www.kuaidaili.com/free/inha/8',
    //     'http://www.kuaidaili.com/free/inha/7',
    //     'http://www.kuaidaili.com/free/inha/6',
    //     'http://www.kuaidaili.com/free/inha/5',
    //     'http://www.kuaidaili.com/free/inha/4',
    //     'http://www.kuaidaili.com/free/inha/3',
    //     'http://www.kuaidaili.com/free/inha/2',
    //     'http://www.kuaidaili.com/free/inha/'
    // ]);
    // c.queue([
    //     'http://www.xicidaili.com/nn/20',
    //     'http://www.xicidaili.com/nn/19',
    //     'http://www.xicidaili.com/nn/18',
    //     'http://www.xicidaili.com/nn/17',
    //     'http://www.xicidaili.com/nn/16',
    //     'http://www.xicidaili.com/nn/15',
    //     'http://www.xicidaili.com/nn/14',
    //     'http://www.xicidaili.com/nn/13',
    //     'http://www.xicidaili.com/nn/12',
    //     'http://www.xicidaili.com/nn/11',
    //     'http://www.xicidaili.com/nn/10',
    //     'http://www.xicidaili.com/nn/9',
    //     'http://www.xicidaili.com/nn/8',
    //     'http://www.xicidaili.com/nn/7',
    //     'http://www.xicidaili.com/nn/6',
    //     'http://www.xicidaili.com/nn/5',
    //     'http://www.xicidaili.com/nn/4',
    //     'http://www.xicidaili.com/nn/3',
    //     'http://www.xicidaili.com/nn/2',
    //     'http://www.xicidaili.com/nn/'
    // ]);
    setTimeout(grabber, 30000);
};


// var url = 'http://p.3qfm.com/ps2/m/kenan/972%E5%9B%9E/00.jpg';
// c.queue([{
//     uri: url,
//     cookie: '__cfduid=d34dee10a5eece31656424c77a40c0c0d1474268798; Expires=Tue, 19 Sep 2017 09:31:46 GMT; Max-Age=31536000; Domain=.3qfm.com; Path=/; HttpOnly',
//     referer: 'http://www.ikanman.com/comic/2027/258602.html',
//     headers: {
//         //'Accept-Encoding': 'gzip, deflate, sdch',
//         //'Accept-Language': 'zh-CN,zh;q=0.8',
//         'Cache-Control': 'no-cache',
//         'Connection': 'keep-alive',
//         'Pragma': 'no-cache',
//         'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1'
//     },
//     download: 'test.jpg',
//     callback: function (err, res) {
//     }
// }]);

// Queue just one URL, with default callback
// c.queue('https://detail.m.tmall.com/item.htm?id=530854851046');

// Queue a list of URLs
//c.queue(['http://cn.bing.com']);

// Queue URLs with custom callbacks & parameters
// c.queue([{
//     uri: 'http://parishackers.org/',
//     jQuery: false,
//     // The global callback won't be called
//     callback: function (err, res) {
//     }
// }]);

// Queue some HTML code directly without grabbing (mostly for tests)
// c.queue([{
//     html: '<p>This is a <strong>test</strong></p>'
// }]);