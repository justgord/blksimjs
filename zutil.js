const R         = require('ramda');
const crypto    = require('crypto');
const bignum    = require('bignum');
const assert    = require('assert');
const ps        = require('process');
const fs        = require('fs');

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
    return padn((100*a/b).toFixed(2),6)+'%';
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


//

var Z=R;

Z.log       = clog;
Z.jlog      = jlog;
Z.padn      = padn;
Z.pct       = pct;
Z.ts        = ts;
Z.each      = each;
Z.hx        = hx;

Z.zsample   = ezsample;
Z.zshuffle  = ezshuffle;
Z.zpick     = ezpick;
Z.zrng      = ezrng;

Z.padn      = padn;
Z.Buf       = ppBuf;

module.exports = Z;
