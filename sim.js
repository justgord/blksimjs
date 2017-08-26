const crypto    = require('crypto');
const assert    = require('assert');
const ps        = require('process');
const fs        = require('fs');
const z         = require('./zutil.js');
const db        = require('./db.js');

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

const each      = z.each;
const padn      = z.padn;
const pct       = z.pct;
const ts        = z.ts;
const zshuffle  = z.zshuffle;
const zsample   = z.zsample;
const zrng      = z.zrng;
const zpick     = z.zpick;



function new_addr()
{
    var nams = ['gord','john','paul','ring','stan','king','julz','lulu','tina','mine','hodl'];

    var swho = zpick(nams);
    var snum = 1000+zrng(5000);
    var snam = swho+'_'+snum;

    var hsh = z.hx(snam);

    if (addrs[hsh])
        return new_addr();  // pick another

    addrs[hsh] = snam;

    //z.log('new addr : '+snam);
    //z.log('     hsh : '+hsh);

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
    z.times(new_addr, NUM_ADDRS);
    addrids=z.keys(addrs);

    //jlog(addrs);

    var ns = z.uniq(z.values(addrs).sort());
    var ps = z.uniq(z.keys(addrs).sort());
    assert(ps.length==NUM_ADDRS, 'bad num uniq add hashes');
    assert(ns.length==NUM_ADDRS, 'bad num uniq addr names');

    //jlog(miners);
    z.log('uniq miners    : '+z.uniq(z.values(miners)).length);
}


///


var NREPS=300;
if (ps.argv.length>2)
    NREPS=parseInt(ps.argv[2]);
assert(NREPS>0);
assert(NREPS<1e5);
z.log('NREPS : '+NREPS);

const TAIL      = 0.9;              // tail part of the chain, where utxos are less prevalent 
const MAX_BLTXN = 3000;
const NUM_ADDRS = 5*NREPS;
const DB_LDB    = 0;                // use ldb storage
const reward    = 10000;            // coinbase reward for mining a block - currency injection

const BL_TXNS   = 0x10000000;
const BL_CUXP   = 0x20000000;


var addrs   = {};                   // addr hash -> addr name  // for easy debug
var addrids = [];
var miners  = {};
var minerids= [];
var wallets = new Map();            // addr -> tid  : unspent txids for active users [ remove when spent ]
var hodlers = {};                   // addr map of people who hardly ever spend


var blknum  = 0;
var ntxmined= 0;

var txns    = new Map();            // tid -> tx
var txbln   = {};                   // tid -> blknum

var blks    = {};                   // bid -> block buff

var utxos   = new Map();            // tid -> tx : transactions with unspent outputs

var blkchain= [];                   // sequential block ids : bno -> bid
var txpool  = [];                   // tids waiting to process
var utxids  = [];                   // randomly sorted utxos - for each spend simulation cycle
var bltxcnt = {};                   // bln -> ntx : block tx count



function onerrlog(_s)
{
    var s=_s;
    return function(err)
    {
        if (err) 
            return z.log('ERR : '+s);
    }
}


function rand_miner()
{
    return zpick(minerids);
}

function rand_user()
{
    return zpick(addrids);
}

function rand_txinp()
{
    if (!utxids.length)
    {
        //z.log('no utxids');
        return 0;
    }
    return utxids.pop(); 
}

function tx_spent(tid, i)
{
    //var tx = txns.get(tid);
    var tx = utxos.get(tid);
    assert(tx,'no such tx : '+tid);

    if (!tx.spent)
        tx.spent = {};
    tx.spent[i]=1;

    // update utxo

    var nspt = z.keys(tx.spent).length;
    if (nspt==tx.vouts.length)
    {
        utxos.delete(tid)       // all outputs are spent
        txns.delete(tid);       // remove spent transactions to save RAM
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
        if (!tx.spent[i])
            return i;
    }
    assert(0,'no unspent outputs for tx ');
    return -1;
}

function rand_spend_val(vv)
{
    var fr = zpick([100, 20, 10, 5, 2, 1]);
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
    //z.log('rand_spend');

    // find an input, a user, send some valu

    var to  = rand_user();

    var txi = rand_txinp();
    if (!txi)
        return;
    //var txib= txns.get(txi);
    var txib= utxos.get(txi);
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
    //z.log('spend : '+nmfr+' > '+nmto+'  : '+padn(v));

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

    //z.log('coinbase : '+addrs[mnr]+' : '+h);

    cash_flow(addrs[mnr], reward);

    wlt_set(mnr, h);

    return h;
}


function blk_catchups()
{
    if (!catchups.length)
        return {};

    var cx = catchups.pop();
    z.log('     CXUP      : '+padn(cx.ntxs,6));

    //              flags, nbyts, blknum, nutxs, [ utxi1 .. utxin ]

    var bl=0;
    bl += 4*4;
    bl += 4*z.keys(cx.bltxs).length;
    bl += 32*cx.ntxs;

    var bf=z.Buf(bl);

    bf.push4(BL_CUXP);      // flags
    bf.push4(cx.len);       // nbyts
    bf.push4(blknum);       // blknum
    bf.push4(cx.ntxs);      // ntxns

    function blxs(txids, nblk)
    {
        bf.push4(txids.length);

        function ptx(tid)
        {
            bf.pushHx(tid);
        }
        each(ptx, txids);
    }
    each(blxs, cx.bltxs);

    cx.bf=bf;
    cx.blen = bl;

    z.log('     len    : '+bl);

    return cx;
}

function blk_prev()
{
    if (blkchain.length)
        return blkchain[blkchain.length-1];
    return '0000000000000000000000000000000000000000000000000000000000000000';
}

function blk_mine()
{
    // bid = z.hx( pow, nonce, blkprev,
    //              flags, nbyts, blknum, ntxns, [ txid1 .. txidn ]     // transaction ids
    //              flags, nbyts, blknum, nutxs, [ utxi1 .. utxin ]     // utxo catchup ids
    //         )


    var tsbl=ts();

    var mnr = rand_miner();
    //z.log('mine  :           > '+miners[mnr]+'  : '+padn(reward));

    var blkprev = blk_prev();
    var txcb    = tx_coinbase(mnr);
    var cx      = blk_catchups();

    // add all from waiting txpool

    var txs = txpool;
    txpool  = [];
    txs.push(txcb); 

    // calc buf len & fill buff

    var len = 0;
    len += 3*32;
    len += 4*4;
    len += 32*txs.length;
    len += cx.blen || 0;

    var bf=z.Buf(len);

    bf.posIncr(32);                 // empty nonce
    bf.pushHx(blkprev);             // previous block id

    bf.push4(BL_TXNS);              // flags
    bf.push4(len);                  // nbyts
    bf.push4(blknum);               // blknum
    bf.push4(txs.length);           // ntxns

    function ptx(tid)
    {
        bf.pushHx(tid);

        txbln[tid] = blknum;             

        var tx = txns.get(tid);
        assert(tx,'no tx for tid : '+tid);

        utxos.set(tid, tx);
    }
    each(ptx, txs);

    if (cx && cx.bf)
        bf.pushBuf(cx.bf.buff);


    // calc pow by changing nonce, until top bytes are 0

    var nonce=0;
    var pow=0;
    var ntries=0;

    function dowork()
    {
        nonce = crypto.randomBytes(32);
        nonce.copy(bf.buff, 0); 

        pow = z.hx(bf.buff);

        ntries++;
    }

    function pow_ok()
    {
        return pow.match('^00');       // 1/256 chance
    }

    dowork();
    while(!pow_ok())
        dowork();


    // calc block hash id

    var blb=z.Buf(32+bf.length);
    blb.pushHx(pow);
    blb.pushBuf(bf.buff);
    var blid=z.hx(blb.buff);

    blks[blid]={bid:blid, byts:blb.buff, txs:txs};

if(0)
{
    z.log('  pow     : '+pow+' : '+ntries);
    //z.log('  block   : '+blb.buff.toString('hex'));
    z.log('  blknum  : '+blknum);
    z.log('  blid    : '+blid);
}

    //save and send block

    blkchain.push(blid);

    //z.log('blockchain :'); jlog(blkchain);
    //z.log('txbln :');      jlog(txbln);

    var dts=ts()-tsbl+1;
    var tps=1000*(txs.length/dts);
    z.log('block : '+padn(blknum,6)+' : '+padn(txs.length,6)+' : '+padn(dts));

    db.save_block(blid, blknum, blb.buff);

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
    var bf  = z.Buf(vouts_bylen(vos));

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

    var bf  = z.Buf(vinps_bylen(vis));

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

    var bf  = z.Buf(tx_bylen(tx));
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
    var h  = z.hx(txb);

    txns.set(h,tx);    

    db.save_tx(h, tx, txb);

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

        nms=z.keys(funds).sort();
    }

    function show_funds()
    {
        for(var i in nms)
        {
            var k = nms[i]; 
            var v = funds[k];
            z.log('  '+k+' : '+padn(v));
        }
    }

    function stats_summ()
    {
        var nutxos = utxos.size;

        z.log();
        z.log('ntrans   : '+padn(ntxmined,10));
        z.log('nutxos   : '+padn(nutxos,10)+' : '+pct(nutxos, ntxmined));
        z.log('val      : '+padn(tot,10));
        z.log('mined    : '+padn(reward*blknum,10));
        z.log();
        z.log('NREPS    : '+padn(NREPS,10));
        z.log('addrs    : '+padn(addrids.length,10));
        
        assert(tot==reward*blknum,'bad total cash check');
        assert(blknum==blkchain.length,'bad blockchain length');
    }

    // cashflow check

    //z.log('cashflows');

    for(var i in nms)
    {
        var k = nms[i]; 
        //z.log('  '+k+' : ');
        cflw=cashes[k];
        var t=0;
        for (var j in cflw)
        {
            var v = cflw[j];
            //z.log('    '+padn(v));
            t+=v;
        }
        //z.log('       -----');
        //z.log('    '+padn(t));

        assert(funds[k]==t,"cashflow mismatch")
    }


    function sample_utxo_time()
    {
        var ts0=ts(); 
        var ks = utxos.keys();
        utxids = zsample(ks, 2000);
        var nuids=utxids.length;
        var dts=ts()-ts0;
        z.log('utxo keys list takes    : '+padn(dts));       // can take 120ms for 150k items !!
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

        //z.log('\nblock utxo density : ');

        function shbl(bid, b)
        {
            var blk=blks[bid];
            var ntr=blk.txs.length;

            var nbl = bld[b] || 0;

            //z.log('  blk utx : '+padn(b,5)+' : '+pct(nbl, ntr));
        }
        each(shbl, blkchain);
    }

    function stats_wallets()
    {
        var totwlt=0;

        function wl(txs, adr)
        {
            var txids=z.keys(txs);
            if (!txids.length)
                return;
            
            //z.log('wallet : '+addrs[adr]); 
            function shw(tid)
            {
                function fvo(vo)
                {
                    if (vo.addr==adr)
                    {
                        //z.log('  '+tid+' : '+vo.val);
                        totwlt+=vo.val;
                    }
                }
                var tx=txns.get(tid);
                each(fvo, tx.vouts);
            }
            each(shw, txids);
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
        else if (zrng(100)<10)      // hodlers trade rarely
            users.push(adr);
    }

    var k = Math.ceil(users.length);
    var n = zrng(2*k)+zrng(k)+zrng(500)+1;
    n = Math.min(MAX_BLTXN-1, n);

    var ads=zsample(users,n);

    if (!ads.length)
        return [];

    var txns = [];
    function ptx(adr)
    {
        var wal = wallets.get(adr);
        var txs = z.keys(wal);
        if (!txs.length)
            return;

        // spend from a tx in the users wallet

        var tid = zpick(txs);
        txns.push(tid);
    }
    each(ptx, ads);

    txns = z.uniq(txns);

    return txns;
}

var catchups=[];
var catchblk=0;

function utx_catchup()
{
    // work thru a catchup series [ or start a new one ]

    //if (catchups.length) return;                 // one-shot for now

    var bld={};                 // bln -> utxo cnt
    var blutxs={};              // bln -> [ utxids ]

    var maxblk = Math.floor(TAIL*blknum);
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

    z.log('\nutxo catchup sections : ');

    function trcxup(cx)
    {
        z.log('  cxup : [ '+padn(cx.blnfr,5)+' - '+padn(cx.blnto,5)+' ] : '+padn(cx.ntxs));
        function trcxb(txs, nb)
        {
            var ntx=txs.length; 
            //z.log('            '+padn(nb)+' '+padn(ntx));
        }
        each(trcxb, cx.bltxs);
        
    }
    each(trcxup, catchups);

    z.log('                    '+padn(catchups.length,6)+' : '+padn(ntxs));

    z.log('               space saved : '+pct(ntxall-ntxs, ntxmined));
    z.log('               scan only   : '+pct(ntxmined-ntxall+ntxs, ntxmined));
}

function catchups_check()
{
    if (catchups.length)
        return;                 // wait until current catchups batch is injected into blocks

    if (!(blknum%100))
        utx_catchup();          // generate new catchups every N blocks
}

function spend_mine()
{
    var ts0=ts(); 

    utxids = wlt_sample_txs(); 
    var nuids=utxids.length;
    var dts=ts()-ts0;

    z.times(rand_spend, nuids);
    var dtp=ts()-ts0;

    z.log('spend :                 : '+padn(dts) + padn(dtp)+' ms');

    blk_mine();

    catchups_check();

    if (blknum%20==1)               // every N blocks write DB
    {
        db.sync();
    }
}

function fini()
{
    var dtp=ts()-ts0+1;

    report_unspent();

    z.log('tps      : '+padn((1000*ntxmined/dtp).toFixed(0),10));

    db.close();
}

function init()
{
    init_users();
    blk_mine();
    z.times(spend_mine, NREPS-1);
    fini();
}



var ts0=ts(); 
db.init(init);
