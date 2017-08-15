const R         = require('ramda');
const crypto    = require('crypto');
const bignum    = require('bignum');
const assert    = require('assert');
const ps        = require('process');
const levelup   = require('levelup');
const fs        = require('fs');

/*
    mine & spend sim :

    grab any txs from mempool, 
    check if txs are unspent
    stamp the block wih pow and prev block hash, 
    publish mined block to block chain
    update unspent and spent, 
    update addr tx list
    make some random txs from addrs that have money 
    rinse n repeat
*/

function clog(s)
{
    console.log(s || '');
}

function jlog(o)
{
    clog(JSON.stringify(o,null,'    '));
}

function hx(s)
{
    var hx  = crypto.createHash('sha256');
    hx.update(s);
    return hx.digest('hex'); 
}


function each(f,mp)
{
    // call f(v,k) on mp, an Array Map or Object

    if (R.is(Array,mp))
    {
        for (var i in mp)
            f(mp[i], i);
        return;
    }

    if (R.is(Map,mp))
    {
        for (var [k, v] of mp)
            f(v, k);
        return;
    }

    assert(R.is(Object, mp), 'each expecting Object as hash');

    R.forEachObjIndexed(f, mp);
}



function padn(s,k)
{
    var n=k || 8;
    s = s+"";
    while (s.length<n)
        s=' '+s; 
    return s;
}

function pct(a,b)
{
    return padn(Math.floor(100*a/b),3)+'%';
}

function ts()
{
    return new Date().getTime();
}

function test_rnd()
{
    // random bytes

    var buf = crypto.randomBytes(32);
    var tok = buf.toString('hex');
    clog('rnd tok : '+tok);

    // hash digest

    var hsh256    = crypto.createHash('sha256');
    hsh256.update('some data to hash');
    clog('hsh256  : '+hsh256.digest('hex'));

    clog('hsh256  : '+hx('some data to hash'));
    clog('hsh256  : '+hx('some data to hash.'));
}


function ezrng(n)
{
    return Math.floor(Math.random()*n);         // weak random
}

function ezpick(rg)
{
    return rg[ezrng(rg.length)];
}

function ezshuffle(arr)
{
    var rg = R.clone(arr);

    assert(rg.length<500,'slow to shuffle large array');

    // fisher yates shuffle

    var i = 0;
    var j = 0;
    var temp = null;

    for (i=rg.length-1; i>0; i-=1) 
    {
        j=ezrng(i+1);
    
        temp = rg[i];
        rg[i] = rg[j];
        rg[j] = temp;
    }

    return rg;
}

function ezsample(arr, _n)
{
    var N=arr.length;
    var n=Math.min(_n, N);    

    if(n>Math.floor(N/5) && N<200)
        return R.take(n, ezshuffle(arr));

    //clog('>>');
    //jlog('len: '+N+' n:'+n);

    var rg=[];
    var ids={};

    function pick()
    {
        var i=ezrng(N);
        while(ids[i])        
        {
            i=ezrng(N);
        }
        ids[i]=1;
        rg.push(arr[i]);
    }
    R.times(pick, n);

    //clog('<<');

    return rg;
}

function new_addr()
{
    var nams = ['gord','john','paul','ring','stan','king','julz','lulu','tina','mine','hodl'];

    var swho = ezpick(nams);
    var snum = 1000+ezrng(5000);
    var snam = swho+'_'+snum;

    var hsh = hx(snam);

    if (addrs[hsh])
        return new_addr();  // pick another

    addrs[hsh] = snam;

    //clog('new addr : '+snam);
    //clog('     hsh : '+hsh);

    if (swho=='mine')
    {
        miners[hsh] = snam;
        minerids.push(hsh);
    }
    else if (swho=='hodl')
    {
        hodlers[hsh]=1;
    }
    
    return hsh;
}


function init_users()
{
    R.times(new_addr, NUM_ADDRS);
    addrids=R.keys(addrs);

    //jlog(addrs);

    var ns = R.uniq(R.values(addrs).sort());
    var ps = R.uniq(R.keys(addrs).sort());
    assert(ps.length==NUM_ADDRS, 'bad num uniq add hashes');
    assert(ns.length==NUM_ADDRS, 'bad num uniq addr names');

    //jlog(miners);
    clog('uniq miners    : '+R.uniq(R.values(miners)).length);
}


function ppBuf(_sz)
{
    // push-pull buffer : maintains an offset for reading/writing

    var sz  = _sz;
    var bf  = Buffer.alloc(sz);
    var p   = 0;                

    var ppb = 
    {
        length : sz,
        buff : bf,

        pos : function()
        {
            return p;
        },

        // push / write

        push4 : function(v)
        {
            bf.writeUInt32LE(v, p);
            p+=4;
        },

        push8 : function(v)
        {
            var bv = bignum(v).toBuffer({endian:'little',size:8});
            bv.copy(bf, p); 
            p+=bv.length;
            assert(bv.length==8, 'bad val len');
        },

        pushHx : function(hx)
        {
            var bx = Buffer.from(hx, 'hex');
            bx.copy(bf, p); 
            p+=bx.length;
            assert(bx.length==32, 'bad hash len');
        },
        pushAddr : function(addr)
        {
            var bx = Buffer.from(addr, 'hex');
            bx.copy(bf, p); 
            p+=bx.length;
            assert(bx.length==32, 'bad addr len');
        },
        pushSign : function(sgn)
        {
            var bx = Buffer.from(sgn, 'hex');
            bx.copy(bf, p); 
            p+=bx.length;
            assert(bx.length==64, 'bad sign len');
        },
        pushBuf: function(bx)
        {
            bx.copy(bf, p); 
            p+=bx.length;
        },

        // position

        posIncr: function(k)
        {
            p+=k;
            assert(p<=bf.length,'bad posIncr');
        },
        posDecr: function(k)
        {
            p-=k;
            assert(p>=0,'bad posDecr');
        },

        // pull / read
        
    };
    return ppb;
}


///


var NREPS=300;
if (ps.argv.length>2)
    NREPS=parseInt(ps.argv[2]);
assert(NREPS>0);
assert(NREPS<1e5);
clog('NREPS : '+NREPS);

const NTAIL     = 0.9*NREPS;        // tail of the chain, where utxos are less prevalent 
const MAX_BLTXN = 3000;
const NUM_ADDRS = 5*NREPS;
const DB_LDB    = 0;                // use ldb storage
const reward    = 10000;            // coinbase reward for mining a block - currency injection


var addrs   = {};                   // addr hash -> addr name  // for easy debug
var addrids = [];
var miners  = {};
var minerids= [];
var wallets = new Map();            // addr -> tid  : unspent txids for active users [ remove when spent ]
var hodlers = {};                   // addr map of people who never spend


var blknum  = 0;
var ntxmined= 0;

var txns    = {};                   // tid -> tx
var txbln   = {};                   // tid -> blknum

var blks    = {};                   // bid -> block buff

var utxos   = new Map();            // tid -> tx : transactions with unspent outputs

var blkchain= [];                   // sequential block ids : bno -> bid
var txpool  = [];                   // tids waiting to process
var utxids  = [];                   // randomly sorted utxos - for each spend simulation cycle
var bltxcnt = {};                   // bln -> ntx : block tx count


// DB


var db = {};

function db_init()
{
    function db_init_ldb()
    {
        assert(fs.existsSync('../ldb/'),'ERR opening LDB dir');

        db.txn   = levelup('../ldb/ldb_txn');
        db.txnby = levelup('../ldb/ldb_txnby');
        db.blkby = levelup('../ldb/ldb_blkby');
        db.blkid = levelup('../ldb/ldb_blkid');
    }

    function db_init_pg()
    {
    }

    if (DB_LDB)
        db_init_ldb();
    else
        db_init_pg();
}

function db_save_block(blid, blknum, blby)
{
if (DB_LDB)
{
    db.blkby.put(blid,   blby,   onerrlog('db bad write blkby'));
    db.blkid.put(blknum, blid,   onerrlog('db bad write blkid'));
}
else
{

}
}

function db_save_tx(tid, tx, txb)
{
if (DB_LDB)
{
    db.txn.put(  tid, tx,  onerrlog('db bad write txn'));
    db.txnby.put(tid, txb, onerrlog('db bad write txnby'));
}
}

function db_close()
{
if (DB_LDB)
{
    return;         //pthread mutex busy issue
    db.txn.close();
    db.txnby.close();
    db.blkby.close();
    db.blkid.close();
}
else
{
}
}

function onerrlog(_s)
{
    var s=_s;
    return function(err)
    {
        if (err) 
            return clog('ERR : '+s);
    }
}


function rand_miner()
{
    return ezpick(minerids);
}

function rand_user()
{
    return ezpick(addrids);
}

function rand_txinp()
{
    if (!utxids.length)
    {
        //clog('no utxids');
        return 0;
    }
    return utxids.pop(); 
}

function tx_spent(tid, i)
{
    var tx = txns[tid];
    assert(tx,'no such tx : '+tid);

    if (!tx.spent)
        tx.spent = {};
    tx.spent[i]=1;

    // update utxo

    var nspt = R.keys(tx.spent).length;
    if (nspt==tx.vouts.length)
    {
        utxos.delete(tid)       // all outputs are spent
        delete txns[tid];       // remove spent transactions to save RAM
    }
}

function wlt_set(adr, tid)
{
    var wal=wallets.get(adr) || {};
    wal[tid]=1;
    wallets.set(adr,wal);
}

function wlt_clear(adr, tid)
{
    var wal=wallets.get(adr) || {};
    delete wal[tid];
    wallets.set(adr,wal);
}

function tx_first_unspent(tx)
{
    for (var i in tx.vouts)
    {
        var vo = tx.vouts[i];
        if (!tx.spent[i])
            return i;
    }
    assert(0,'no unspent outputs for tx ');
    return -1;
}

function rand_spend_val(vv)
{
    var fr = ezpick([100, 20, 10, 5, 2, 1]);
    var v = parseInt(vv/fr);
    if (v<=0)
        v=vv;
    return v;
}

function rand_sig()
{
    return crypto.randomBytes(64).toString('hex');
}

function rand_sig64()
{
    return crypto.randomBytes(64).toString('base64');
}

function rand_addr64()
{
    return crypto.randomBytes(32).toString('base64');
}


function rand_spend()
{
    //clog('rand_spend');

    // find an input, a user, send some valu

    var to  = rand_user();

    var txi = rand_txinp();
    if (!txi)
        return;
    var txib= txns[txi];
    assert(txib, 'no txn for : '+txi);

    var vn  = tx_first_unspent(txib);
    var vo  = txib.vouts[vn];
    assert(vo,'bad vo for tx : '+txi);
    var v = rand_spend_val(vo.val);
    if (v==0 || vo.addr==to)                // skip 0 spend, or sending to self
    {
        return;
    }
    var chg = vo.val-v;
    var sig = rand_sig();
    var bln = txbln[txi]; 
    var bid = blkchain[bln]; 
    assert(bid,'bad block id for tx : '+txi);
    var vin = vinp_make(txi, vn, bln, bid, vo.addr, sig);
    assert((chg+v)==vo.val,'value sum issue');

    // make the trans

    var vos = [ vout_make(to, v) ];
    if (chg>0)
        vos.push(vout_make(vo.addr, chg));

    var h   = tx_make([vin], vos);
    txpool.push(h);    

    tx_spent(txi, vn);

    wlt_clear(vo.addr, txi);
    wlt_set(to, h);
    if (chg>0)
        wlt_set(vo.addr, h);

    var nmfr = addrs[vo.addr];
    var nmto = addrs[to];
    //clog('spend : '+nmfr+' > '+nmto+'  : '+padn(v));

    cash_flow(nmfr, -v);
    cash_flow(nmto, v);

    return h;
}

var cashes={};

function cash_flow(to, v)
{
    if (!cashes[to])
        cashes[to]=[];

    cashes[to].push(v);
}

function tx_coinbase(mnr)
{

    var vo0 = vout_make(mnr, reward);
    var h   = tx_make([], [vo0]);

    //clog('coinbase : '+addrs[mnr]+' : '+h);

    cash_flow(addrs[mnr], reward);

    wlt_set(mnr, h);

    return h;
}

function blk_mine()
{
    // bid = hx( pow, blkprev, flags, blknum, nbyts, ntxns, [txid1 .. txidn], nonce )           
    // block contains txids only, not tx bodies !

    var tsbl=ts();

    var mnr = rand_miner();
    //clog('mine  :           > '+miners[mnr]+'  : '+padn(reward));

    var txcb=tx_coinbase(mnr);

    // add all from waiting txpool

    var txs = txpool;
    txpool  = [];
    txs.push(txcb); 

    // calc buf len

    var len = 0;
    len += 32;      // pow
    len += 32;      // blkprev
    len +=  4;      // flags
    len +=  4;      // blknum
    len +=  4;      // nbyts
    len +=  4;      // ntxns
    len += 32*txs.length;
    len += 32;      // nonce

    // fill buf

    var bf=ppBuf(len);

    bf.posIncr(32);                 // blkprev      //todo keep hashid of prev blocks
    bf.push4(0);                    // flags
    bf.push4(blknum);               // blknum
    bf.push4(len);                  // nbyts
    bf.push4(txs.length);           // ntxns

    for (var i in txs)
    {
        var txid  = txs[i];

        //clog('  tx      : '+txid);

        bf.pushHx(txid);                // only txid in block

        txbln[txid] = blknum;             
        utxos.set(txid, txns[txid]);
    }
    bf.posIncr(32);                     // empty nonce

    // calc pow by changing nonce, until top bytes are 0

    var nonce=0;
    var pow=0;
    var ntries=0;

    function dowork()
    {
        nonce = crypto.randomBytes(32);

        bf.posDecr(32);
        bf.pushBuf(nonce);
        
        ntries++;
    }

    function pow_ok()
    {
        pow = hx(bf.buff);
        var bok = pow.match('^00');       // 1/256 chance
        return bok;
    }

    dowork();
    while(!pow_ok())
        dowork();


    // calc block hash id

    var blb=ppBuf(32+bf.length);
    blb.pushHx(pow);
    blb.pushBuf(bf.buff);
    var blid=hx(blb.buff);

    blks[blid]={bid:blid, byts:blb.buff, txs:txs};

if(0)
{
    clog('  pow     : '+pow+' : '+ntries);
    //clog('  block   : '+blb.buff.toString('hex'));
    clog('  blknum  : '+blknum);
    clog('  blid    : '+blid);
}

    //save and send block

    blkchain.push(blid);

    //clog('blockchain :'); jlog(blkchain);
    //clog('txbln :');      jlog(txbln);

    var dts=ts()-tsbl+1;
    var tps=1000*(txs.length/dts);
    clog('block : '+padn(blknum,6)+' : '+padn(txs.length,6)+' : '+padn(dts));

    db_save_block(blid, blknum, blb.buff);

    ntxmined+=txs.length;
    bltxcnt[blknum]=txs.length;
    blknum++;
}

function vinp_make(txid, idx, blk, bid, addr, sign)
{
    return {txid:txid, idx:idx, blk:blk, bid:bid, addr:addr, sign:sign};
}

function vout_make(addr, val)
{
    return {addr:addr, val:val};
}

function vouts_bylen(vos)
{
    // ( addr, val )
    var d   = 32 + 8;
    return (4 + d*vos.length);
}

function vouts_byts(vos)
{
    // ( addr, val )
    var bf  = ppBuf(vouts_bylen(vos));

    bf.push4(vos.length); 

    for (var i in vos)
    {   
        var vo = vos[i];

        bf.pushAddr(vo.addr);        

        bf.push8(vo.val); 
    }

    return bf.buff;
}

function vinps_bylen(vis)
{
    // (txid, idx, blk, bid, addr, sign)
    var d   = 32 + 4 + 4 + 32 + 32 + 64; 
    return 4 + d*vis.length;
}

function vinps_byts(vis)
{
    // (txid, idx, blk, bid, addr, sign)

    var bf  = ppBuf(vinps_bylen(vis));

    bf.push4(vis.length);

    for (var i in vis)
    {
        var vi = vis[i];

        bf.pushAddr(vi.txid);
        bf.push4(   vi.idx);
        bf.push4(   vi.blk);
        bf.pushHx(  vi.bid);
        bf.pushAddr(vi.addr);
        bf.pushSign(vi.sign);
    }

    return bf.buff;
}

function tx_bylen(tx)
{
    // ( vinps, vouts, ts, rn )
    var d=0;
    d += vinps_bylen(tx.vinps);
    d += vouts_bylen(tx.vouts);
    d += 8;
    d += 8;
    return d;
}

function tx_byts(tx)
{
    // ( vinps, vouts, ts, rn )

    var bvis = vinps_byts(tx.vinps);
    var bvos = vouts_byts(tx.vouts);

    var bf  = ppBuf(tx_bylen(tx));
    bf.pushBuf(bvis);
    bf.pushBuf(bvos);

    bf.push8(tx.ts);
    bf.pushBuf(tx.rn);

    return bf.buff;
}


function tx_make(vis, vos)
{
    // ( vinps, vouts, ts, rn )   

    var ts = new Date().getTime();
    var rn = crypto.randomBytes(8);

    var tx = {vinps:vis, vouts:vos, ts:ts, rn:rn, spent:{}};    // spent is for utxo internals

    var txb= tx_byts(tx);
    var h  = hx(txb);
    txns[h]= tx;

    db_save_tx(h, tx, txb);

    return h;
}

///

function report_unspent()
{
    var funds={};
    var nms=[];
    var tot = 0;

    function check_funds()
    {
        function addval(vo)
        {
            var snam = addrs[vo.addr];
            if (!funds[snam])
                funds[snam]=0;
            funds[snam]+=vo.val;
            tot+=vo.val
        }
        
        function gathr(tx, tid)
        {
            for (var k in tx.vouts)
            {
                var vo = tx.vouts[k];
                assert(tx.spent);
                if (!tx.spent[k])
                    addval(vo);
            }
        }
        each(gathr, utxos);

        nms=R.keys(funds).sort();
    }

    function show_funds()
    {
        for(var i in nms)
        {
            var k = nms[i]; 
            var v = funds[k];
            clog('  '+k+' : '+padn(v));
        }
    }

    function stats_summ()
    {
        var nutxos = utxos.size;
        var utxpct = Math.floor(100*nutxos/ntxmined);

        clog();
        clog('ntrans   : '+padn(ntxmined,10));
        clog('nutxos   : '+padn(nutxos,10)+' : '+utxpct+'%');
        clog('val      : '+padn(tot,10));
        clog('mined    : '+padn(reward*blknum,10));
        clog();
        clog('NREPS    : '+padn(NREPS,10));
        clog('addrs    : '+padn(addrids.length,10));
        
        assert(tot==reward*blknum,'bad total cash check');
        assert(blknum==blkchain.length,'bad blockchain length');
    }

    // cashflow check

    //clog('cashflows');

    for(var i in nms)
    {
        var k = nms[i]; 
        //clog('  '+k+' : ');
        cflw=cashes[k];
        var t=0;
        for (var j in cflw)
        {
            var v = cflw[j];
            //clog('    '+padn(v));
            t+=v;
        }
        //clog('       -----');
        //clog('    '+padn(t));

        assert(funds[k]==t,"cashflow mismatch")
    }


    function sample_utxo_time()
    {
        var ts0=ts(); 
        var ks = utxos.keys();
        utxids = ezsample(ks, 2000);
        var nuids=utxids.length;
        var dts=ts()-ts0;
        clog('utxo keys list takes    : '+padn(dts));       // can take 120ms for 150k items !!
    }

    var blutxs={};

    function stats_utxo_density()
    {
        // utxo density per block

        var bld={};

        function wlk(tx, tid)
        {
            var bln=txbln[tid];

            if (!bld[bln])
                bld[bln]=0;
            bld[bln]++;

            if (!blutxs[bln])
                blutxs[bln]=[];
            blutxs[bln].push(tid);
        }
        each(wlk,utxos);

        clog('\nblock utxo density : ');

        function shbl(bid, b)
        {
            var blk=blks[bid];
            var ntr=blk.txs.length;

            var nbl = bld[b] || 0;
            var d=nbl/ntr;


            if (b<NTAIL)
            {
                clog('  blk utx : '+padn(b,5)+' : '+padn(d.toFixed(2),5)+' : '+padn(nbl,4)+' / '+padn(ntr,4));
                //jlog(blutxs[b]);
            }
        }
        each(shbl, blkchain);
    }

    function stats_wallets()
    {
        var totwlt=0;

        function wl(txs, adr)
        {
            var txids=R.keys(txs);
            if (!txids.length)
                return;
            
            //clog('wallet : '+addrs[adr]); 
            function shw(tid)
            {
                var tx=txns[tid];
                for (var i in tx.vouts)
                {
                    var vo=tx.vouts[i];
                    if (vo.addr==adr)
                    {
                        //clog('  '+tid+' : '+vo.val);
                        totwlt+=vo.val;
                    }
                }
            }
            R.forEach(shw, txids);
        }
        each(wl, wallets);

        assert(totwlt==tot,'wallet total : '+totwlt+' != '+tot);
    }

    check_funds();
    //show_funds();

    stats_wallets();
    stats_utxo_density();
    stats_summ();
}

function wlt_sample_txs()
{
    var users = [];
    for (var adr of wallets.keys())
    {
        if (!hodlers[adr])
            users.push(adr);
        else if (ezrng(100)<10)      // hodlers trade rarely
            users.push(adr);
    }

    var k = Math.ceil(users.length);
    var n = ezrng(2*k)+ezrng(k)+ezrng(500)+1;
    n = Math.min(MAX_BLTXN-1, n);

    var ads=ezsample(users,n);

    if (!ads.length)
        return [];

    var txns = [];
    function ptx(adr)
    {
        var wal = wallets.get(adr);
        var txs = R.keys(wal);
        if (!txs.length)
            return;

        // spend from a tx in the users wallet

        var tid = ezpick(txs);
        txns.push(tid);
    }
    R.forEach(ptx,ads);

    txns = R.uniq(txns);

    return txns;
}

var catchups=[];
var catchblk=0;

function utx_catchup()
{
    // work thru a catchup series [ or start a new one ]

    if (catchups.length)
        return;                 // one-shot for now

    var bld={};                 // bln -> utxo cnt
    var blutxs={};              // bln -> [ utxids ]

    var maxblk = Math.floor(NTAIL);
    var maxtns = MAX_BLTXN;
    var ntxall = 0;

    function gathr(tx, tid)
    {
        var bln=txbln[tid];

        if (bln>=maxblk)
            return;

        if (!bld[bln])
            bld[bln]=0;
        bld[bln]++;

        if (!blutxs[bln])
            blutxs[bln]=[];
        blutxs[bln].push(tid);
    }
    each(gathr,utxos);

    // create sections of catchups

    var ntxs = 0;
    var nbl  = 0;
    var cxup = {blnfr:0, blnto:0, ntxs:0, bltxs:{}};

    while(nbl<maxblk)
    {
        var txs = blutxs[nbl];
        var ntx = 0;

        if (txs && txs.length)
        {
            ntx = txs.length;

            if ((cxup.ntxs+ntx) >= maxtns)
            {
                // finish last catchup, make next one

                catchups.push(cxup);
                cxup={blnfr:nbl, blnto:nbl, ntxs:0, bltxs:{}};
            }

            cxup.blnto=nbl;
            cxup.bltxs[nbl]=txs;
        }

        nbl++;
        ntxs+=ntx;
        cxup.ntxs+=ntx;

        ntxall+=bltxcnt[nbl];
    }
    catchups.push(cxup);

    clog('\nutxo catchup sections : ');

    function trcxup(cx)
    {
        clog('  cxup : [ '+padn(cx.blnfr,5)+' - '+padn(cx.blnto,5)+' ] : '+padn(cx.ntxs));
        function trcxb(txs, nb)
        {
            var ntx=txs.length; 
            //clog('            '+padn(nb)+' '+padn(ntx));
        }
        each(trcxb, cx.bltxs);
        
    }
    each(trcxup, catchups);
    clog('                    '+padn(catchups.length,6)+' : '+padn(ntxs));

    clog('               space saved : '+pct(ntxall-ntxs, ntxmined));
    clog('               scan only   : '+pct(ntxmined-ntxall+ntxs, ntxmined));

}


function spend_mine()
{
    var ts0=ts(); 

    utxids = wlt_sample_txs(); 
    var nuids=utxids.length;
    var dts=ts()-ts0;

    R.times(rand_spend, nuids);
    var dtp=ts()-ts0;

    clog('spend :                 : '+padn(dts) + padn(dtp));

    blk_mine();
}

///

db_init();
init_users();

var ts0=ts(); 
blk_mine();
R.times(spend_mine, NREPS-1);
var dtp=ts()-ts0+1;

report_unspent();

clog('tps      : '+padn((1000*ntxmined/dtp).toFixed(0),10));

utx_catchup();

db_close();

///



