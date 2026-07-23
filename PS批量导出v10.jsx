/*
 * 批量导出（Web所用格式旧版算法 + WebP支持）
 * 兼容范围: Adobe Photoshop 2020 - 2026+
 * 平台: Windows / macOS
 */

#target photoshop

app.displayDialogs = DialogModes.NO;

function getPSVersion() { return parseFloat(app.version); }

function s2t(s) { return app.stringIDToTypeID(s); }

function deleteFile(filePath) {
    try {
        var f = new File(filePath);
        if (f.exists) f.remove();
    } catch(e) {}
}

function isUserCancel(err) {
    var msg = (err && err.message) ? err.message.toLowerCase() : "";
    return (
        msg.indexOf("user")      !== -1 ||
        msg.indexOf("cancel")    !== -1 ||
        msg.indexOf("stop")      !== -1 ||
        msg.indexOf("interrupt") !== -1 ||
        err.number === 8007              ||
        err.number === -128
    );
}

// 获取文件大小
function getFileSizeBytes(filePath) {
    try {
        var f = new File(filePath);
        if (!f.exists) return 0;
        if (f.open("r")) {
            f.seek(0, 2);
            var sz = f.tell();
            f.close();
            if (typeof sz === "number" && sz > 0) return sz;
        }
        var len = f.length;
        if (typeof len === "number" && len > 0) return len;
        return 0;
    } catch(e) { return 0; }
}

// ------------------------------------------------------------
// 新增：底层获取当前选中的多个图层ID
// ------------------------------------------------------------
function getSelectedLayerIDs() {
    var selectedLayerIDs = [];
    try {
        var hasBg = false;
        try { hasBg = (app.activeDocument.backgroundLayer !== null); } catch(e) {}
        
        var ref = new ActionReference();
        ref.putProperty(s2t("property"), s2t("targetLayers"));
        ref.putEnumerated(s2t("document"), s2t("ordinal"), s2t("targetEnum"));
        var desc = executeActionGet(ref);
        
        if (desc.hasKey(s2t("targetLayers"))) {
            var list = desc.getList(s2t("targetLayers"));
            for (var i = 0; i < list.count; i++) {
                var index = list.getReference(i).getIndex();
                // 核心修复：如果没有背景层，抵消 PS 脑残的索引偏移
                if (!hasBg) { index += 1; } 
                
                var ref2 = new ActionReference();
                ref2.putProperty(s2t("property"), s2t("layerID"));
                ref2.putIndex(s2t("layer"), index);
                selectedLayerIDs.push(executeActionGet(ref2).getInteger(s2t("layerID")));
            }
        } else {
            var ref2 = new ActionReference();
            ref2.putProperty(s2t("property"), s2t("layerID"));
            ref2.putEnumerated(s2t("layer"), s2t("ordinal"), s2t("targetEnum"));
            selectedLayerIDs.push(executeActionGet(ref2).getInteger(s2t("layerID")));
        }
    } catch(e) {}
    return selectedLayerIDs;
}

function selectLayerByID(id) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putIdentifier(s2t("layer"), id);
    desc.putReference(s2t("null"), ref);
    desc.putBoolean(s2t("makeVisible"), false);
    executeAction(s2t("select"), desc, DialogModes.NO);
}

function getLayerNameByID(id) {
    try {
        var ref = new ActionReference();
        ref.putProperty(s2t("property"), s2t("name"));
        ref.putIdentifier(s2t("layer"), id);
        return executeActionGet(ref).getString(s2t("name"));
    } catch(e) { return "Layer_" + id; }
}

// ============================================================
// 偏好设置
// ============================================================
function getPrefsFile() {
    return new File(Folder(app.preferencesFolder).fsName + "/BatchExportPrefs.txt");
}

function loadPrefs() {
    var prefs = {
        inFolder: null, outFolder: null,
        sourceType: 0, formatIndex: 0,
        jpgQualityText: "80", jpgQualityDrop: 3,
        pngTransparent: true,
        webpLossless: false, webpQualityText: "75", webpQualityDrop: 3,
        webpXMP: false, webpEXIF: false, webpPS: false,
        useOrigSize: false, targetW: "", targetH: "",
        maxSize: "", sizeUnitIndex: 0, metaIndex: 0, doSRGB: true
    };
    var f = getPrefsFile();
    if (!f.exists) return prefs;
    f.open("r");
    var lines = [];
    while (!f.eof) lines.push(f.readln());
    f.close();
    function ln(i, d)    { return (lines.length > i && lines[i] !== undefined) ? lines[i] : String(d); }
    function lnInt(i, d) { var v = parseInt(ln(i, d), 10); return isNaN(v) ? d : v; }
    function lnB(i, d)   { return lines.length > i ? lines[i] === "1" : d; }
    if (ln(0,"") !== "") { var fi = new Folder(ln(0,"")); if (fi.exists) prefs.inFolder  = fi; }
    if (ln(1,"") !== "") { var fo = new Folder(ln(1,"")); if (fo.exists) prefs.outFolder = fo; }
    prefs.sourceType      = lnInt(2, 0);    prefs.formatIndex    = lnInt(3, 0);
    prefs.jpgQualityText  = ln(4, "80");    prefs.jpgQualityDrop = lnInt(5, 3);
    prefs.webpLossless    = lnB(6, false);  prefs.webpQualityText= ln(7, "75");
    prefs.webpQualityDrop = lnInt(8, 3);    prefs.webpXMP        = lnB(9,  false);
    prefs.webpEXIF        = lnB(10, false); prefs.webpPS         = lnB(11, false);
    prefs.useOrigSize     = lnB(12, false); prefs.targetW        = ln(13, "");
    prefs.targetH         = ln(14, "");     prefs.maxSize        = ln(15, "");
    prefs.sizeUnitIndex   = lnInt(16, 0);   prefs.metaIndex      = lnInt(17, 0);
    prefs.doSRGB          = lnB(18, true);  prefs.pngTransparent = lnB(19, true);
    return prefs;
}

function savePrefs(inFolder, outFolder, p) {
    try {
        var f = getPrefsFile(); f.open("w");
        f.writeln(inFolder  ? inFolder.fsName  : "");
        f.writeln(outFolder ? outFolder.fsName : "");
        f.writeln(String(p.sourceType));       f.writeln(String(p.formatIndex));
        f.writeln(p.jpgQualityText);           f.writeln(String(p.jpgQualityDrop));
        f.writeln(p.webpLossless ? "1" : "0"); f.writeln(p.webpQualityText);
        f.writeln(String(p.webpQualityDrop));
        f.writeln(p.webpXMP  ? "1" : "0");    f.writeln(p.webpEXIF ? "1" : "0");
        f.writeln(p.webpPS   ? "1" : "0");    f.writeln(p.useOrigSize ? "1" : "0");
        f.writeln(p.targetW);                  f.writeln(p.targetH);
        f.writeln(p.maxSize);                  f.writeln(String(p.sizeUnitIndex));
        f.writeln(String(p.metaIndex));        f.writeln(p.doSRGB ? "1" : "0");
        f.writeln(p.pngTransparent ? "1" : "0");
        f.close();
    } catch(e) {}
}

// ============================================================
// 进度窗口
// ============================================================
function createProgressWindow(total) {
    var pw = new Window("palette", "正在处理...", undefined);
    pw.orientation   = "column";
    pw.alignChildren = ["fill", "top"];
    pw.spacing  = 10;
    pw.margins  = 16;
    pw.minimumSize = [380, 0];

    var lblTotal = pw.add("statictext", undefined, "准备中...");
    lblTotal.alignment = ["fill", "top"];

    var lblFile = pw.add("statictext", undefined, "");
    lblFile.alignment  = ["fill", "top"];
    lblFile.characters = 40;

    var bar = pw.add("progressbar", undefined, 0, total);
    bar.preferredSize.width  = 360;
    bar.preferredSize.height = 16;

    var lblFail = pw.add("statictext", undefined, "");
    lblFail.alignment = ["fill", "top"];

    var lblHint = pw.add("statictext", undefined,
        "处理中，请勿关闭 PS。\n如需中途取消，请连续点按 Esc 键。\n已处理完的文件不受影响，中断时正在写入的文件将自动删除。",
        {multiline: true});
    lblHint.alignment = ["fill", "top"];
    lblHint.preferredSize.width = 360;

    pw.show();

    return {
        update: function(index, fileName) {
            lblTotal.text = "正在处理: " + (index + 1) + " / " + total;
            lblFile.text  = fileName.length > 45
                ? fileName.substring(0, 42) + "..." : fileName;
            bar.value = index;
            try { app.statusLine = "批量处理: " + (index+1) + "/" + total + " - " + fileName; } catch(e) {}
            app.refresh();
        },
        done: function(index) {
            bar.value = index + 1;
            app.refresh();
        },
        setFail: function(count) {
            lblFail.text = count > 0 ? "失败: " + count + " 张" : "";
            app.refresh();
        },
        close: function() {
            try { app.statusLine = ""; } catch(e) {}
            try { pw.close(); } catch(e) {}
        }
    };
}

// ============================================================
// 主设置 UI
// ============================================================
// ============================================================
// 打赏窗口
// ============================================================
function showDonateWindow() {
    // ★★★ 在下方两处引号内粘贴你的Base64字符串 ★★★
    var wxBase64  = "iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAKQ2lDQ1BJQ0MgcHJvZmlsZQAAeNqdU3dYk/cWPt/3ZQ9WQtjwsZdsgQAiI6wIyBBZohCSAGGEEBJAxYWIClYUFRGcSFXEgtUKSJ2I4qAouGdBiohai1VcOO4f3Ke1fXrv7e371/u855zn/M55zw+AERImkeaiagA5UoU8Otgfj09IxMm9gAIVSOAEIBDmy8JnBcUAAPADeXh+dLA//AGvbwACAHDVLiQSx+H/g7pQJlcAIJEA4CIS5wsBkFIAyC5UyBQAyBgAsFOzZAoAlAAAbHl8QiIAqg0A7PRJPgUA2KmT3BcA2KIcqQgAjQEAmShHJAJAuwBgVYFSLALAwgCgrEAiLgTArgGAWbYyRwKAvQUAdo5YkA9AYACAmUIszAAgOAIAQx4TzQMgTAOgMNK/4KlfcIW4SAEAwMuVzZdL0jMUuJXQGnfy8ODiIeLCbLFCYRcpEGYJ5CKcl5sjE0jnA0zODAAAGvnRwf44P5Dn5uTh5mbnbO/0xaL+a/BvIj4h8d/+vIwCBAAQTs/v2l/l5dYDcMcBsHW/a6lbANpWAGjf+V0z2wmgWgrQevmLeTj8QB6eoVDIPB0cCgsL7SViob0w44s+/zPhb+CLfvb8QB7+23rwAHGaQJmtwKOD/XFhbnauUo7nywRCMW735yP+x4V//Y4p0eI0sVwsFYrxWIm4UCJNx3m5UpFEIcmV4hLpfzLxH5b9CZN3DQCshk/ATrYHtctswH7uAQKLDljSdgBAfvMtjBoLkQAQZzQyefcAAJO/+Y9AKwEAzZek4wAAvOgYXKiUF0zGCAAARKCBKrBBBwzBFKzADpzBHbzAFwJhBkRADCTAPBBCBuSAHAqhGJZBGVTAOtgEtbADGqARmuEQtMExOA3n4BJcgetwFwZgGJ7CGLyGCQRByAgTYSE6iBFijtgizggXmY4EImFINJKApCDpiBRRIsXIcqQCqUJqkV1II/ItchQ5jVxA+pDbyCAyivyKvEcxlIGyUQPUAnVAuagfGorGoHPRdDQPXYCWomvRGrQePYC2oqfRS+h1dAB9io5jgNExDmaM2WFcjIdFYIlYGibHFmPlWDVWjzVjHVg3dhUbwJ5h7wgkAouAE+wIXoQQwmyCkJBHWExYQ6gl7CO0EroIVwmDhDHCJyKTqE+0JXoS+cR4YjqxkFhGrCbuIR4hniVeJw4TX5NIJA7JkuROCiElkDJJC0lrSNtILaRTpD7SEGmcTCbrkG3J3uQIsoCsIJeRt5APkE+S+8nD5LcUOsWI4kwJoiRSpJQSSjVlP+UEpZ8yQpmgqlHNqZ7UCKqIOp9aSW2gdlAvU4epEzR1miXNmxZDy6Qto9XQmmlnafdoL+l0ugndgx5Fl9CX0mvoB+nn6YP0dwwNhg2Dx0hiKBlrGXsZpxi3GS+ZTKYF05eZyFQw1zIbmWeYD5hvVVgq9ip8FZHKEpU6lVaVfpXnqlRVc1U/1XmqC1SrVQ+rXlZ9pkZVs1DjqQnUFqvVqR1Vu6k2rs5Sd1KPUM9RX6O+X/2C+mMNsoaFRqCGSKNUY7fGGY0hFsYyZfFYQtZyVgPrLGuYTWJbsvnsTHYF+xt2L3tMU0NzqmasZpFmneZxzQEOxrHg8DnZnErOIc4NznstAy0/LbHWaq1mrX6tN9p62r7aYu1y7Rbt69rvdXCdQJ0snfU6bTr3dQm6NrpRuoW623XP6j7TY+t56Qn1yvUO6d3RR/Vt9KP1F+rv1u/RHzcwNAg2kBlsMThj8MyQY+hrmGm40fCE4agRy2i6kcRoo9FJoye4Ju6HZ+M1eBc+ZqxvHGKsNN5l3Gs8YWJpMtukxKTF5L4pzZRrmma60bTTdMzMyCzcrNisyeyOOdWca55hvtm82/yNhaVFnMVKizaLx5balnzLBZZNlvesmFY+VnlW9VbXrEnWXOss623WV2xQG1ebDJs6m8u2qK2brcR2m23fFOIUjynSKfVTbtox7PzsCuya7AbtOfZh9iX2bfbPHcwcEh3WO3Q7fHJ0dcx2bHC866ThNMOpxKnD6VdnG2ehc53zNRemS5DLEpd2lxdTbaeKp26fesuV5RruutK10/Wjm7ub3K3ZbdTdzD3Ffav7TS6bG8ldwz3vQfTw91jicczjnaebp8LzkOcvXnZeWV77vR5Ps5wmntYwbcjbxFvgvct7YDo+PWX6zukDPsY+Ap96n4e+pr4i3z2+I37Wfpl+B/ye+zv6y/2P+L/hefIW8U4FYAHBAeUBvYEagbMDawMfBJkEpQc1BY0FuwYvDD4VQgwJDVkfcpNvwBfyG/ljM9xnLJrRFcoInRVaG/owzCZMHtYRjobPCN8Qfm+m+UzpzLYIiOBHbIi4H2kZmRf5fRQpKjKqLupRtFN0cXT3LNas5Fn7Z72O8Y+pjLk722q2cnZnrGpsUmxj7Ju4gLiquIF4h/hF8ZcSdBMkCe2J5MTYxD2J43MC52yaM5zkmlSWdGOu5dyiuRfm6c7Lnnc8WTVZkHw4hZgSl7I/5YMgQlAvGE/lp25NHRPyhJuFT0W+oo2iUbG3uEo8kuadVpX2ON07fUP6aIZPRnXGMwlPUit5kRmSuSPzTVZE1t6sz9lx2S05lJyUnKNSDWmWtCvXMLcot09mKyuTDeR55m3KG5OHyvfkI/lz89sVbIVM0aO0Uq5QDhZML6greFsYW3i4SL1IWtQz32b+6vkjC4IWfL2QsFC4sLPYuHhZ8eAiv0W7FiOLUxd3LjFdUrpkeGnw0n3LaMuylv1Q4lhSVfJqedzyjlKD0qWlQyuCVzSVqZTJy26u9Fq5YxVhlWRV72qX1VtWfyoXlV+scKyorviwRrjm4ldOX9V89Xlt2treSrfK7etI66Trbqz3Wb+vSr1qQdXQhvANrRvxjeUbX21K3nShemr1js20zcrNAzVhNe1bzLas2/KhNqP2ep1/XctW/a2rt77ZJtrWv913e/MOgx0VO97vlOy8tSt4V2u9RX31btLugt2PGmIbur/mft24R3dPxZ6Pe6V7B/ZF7+tqdG9s3K+/v7IJbVI2jR5IOnDlm4Bv2pvtmne1cFoqDsJB5cEn36Z8e+NQ6KHOw9zDzd+Zf7f1COtIeSvSOr91rC2jbaA9ob3v6IyjnR1eHUe+t/9+7zHjY3XHNY9XnqCdKD3x+eSCk+OnZKeenU4/PdSZ3Hn3TPyZa11RXb1nQ8+ePxd07ky3X/fJ897nj13wvHD0Ivdi2yW3S609rj1HfnD94UivW2/rZffL7Vc8rnT0Tes70e/Tf/pqwNVz1/jXLl2feb3vxuwbt24m3Ry4Jbr1+Hb27Rd3Cu5M3F16j3iv/L7a/eoH+g/qf7T+sWXAbeD4YMBgz8NZD+8OCYee/pT/04fh0kfMR9UjRiONj50fHxsNGr3yZM6T4aeypxPPyn5W/3nrc6vn3/3i+0vPWPzY8Av5i8+/rnmp83Lvq6mvOscjxx+8znk98ab8rc7bfe+477rfx70fmSj8QP5Q89H6Y8en0E/3Pud8/vwv94Tz+4A5JREAAAAZdEVYdFNvZnR3YXJlAEFkb2JlIEltYWdlUmVhZHlxyWU8AABko0lEQVR42uy9B5wV1dk/fs7M3L59l92lF5EqYEFBYrChxhI1GlFjxSAaxZQ3xhZRsSXR6Gtij9ijicGeqLEg2CMgiID0trTt/faZOb/v3KPHw+yd2dm7u2je//+Rz3rvnZkzpzzneb7Pc57zHPrwww9/9NFHpHdo5syZ3//+97Ne+t3vfrd27Vr+edKkSZdddlmnpdXX1//2t79NJBKd3nnttdeOGjWq4+94ds6cObW1tfzrKaecctppp/HPdXV1119/fdbCR4wYgfeKr7fddtv69es73hYMBm+99dY+ffrwry+++OIrr7zCP5eXl99yyy24odOa47aNGzfyz4cddtjFF1/cnf5HD6Ofxdcbbrhhn3324Z8/+OCDefPm9dK4f+973yM//vGPSa/RQw89xBxo4sSJ4raTTz6ZeaDNmzd7fO8777yTtYTW1laMsbjtqquuEpc2bNjgVNoBBxwgF4KvTneiEHEbChe/46V4tZc2TpgwQTw1ffp01j1CP8jV+/DDD8UlDE3vjTuYSgmHw733Ar/f73QpLy9PfPZYB0VR8vPzvdypaVrW3ymlcgmyCHEpXK5qx6+C8DgKyVo4LuHVXmoeiUS62i3e+0H+6jI03SfUXCHfEslKxzAML49gqOLxuJc7fT5fV28LhUJOYy+zCyidTne1sSjZI5fk0C3e+6H7BXaBp23TZcyYMd0pLpVKrVy50jTNTu+EzBftLC0tXbJkSaePNDY2Tp48OZlMdnrn1q1bRZ+i8GHDhmW9bdu2beK9O3fu1HU9620tLS1y9YYOHSpqDti3ZcsWL+wCNQTe5V9RH9TKSe2qqso/FxUVOXVL//79+/Xrl/XSpk2b0FGiHw4++GBxqaCgwGnmjBs3rpsy7Msvv4xGo998P//888XnQw45pJtKvaamRtYUjz32mJennnvuOS9VR29CYnkpELBXPHXmmWeK39va2gR6zZlg64gCn3nmGVnfYVDFJSBlpxKeeuopL6144oknnEqYO3eu01MyaIbl5HQbhkZW7hi4bg49mEdmqj2EPC53s9OdJr07eZFwIExlj+WLSW/73CMkK5TclItNtzqRy3C4NEq+5PFFOQ+cS217GGN1nzXdkUoO5XtEzd/B9ubcSzm0vccbonwX+sKjUAG6EjCl0zuzChUXhN59CQ01HQgEvBgQHuWcixTJwYDYy6S5XPvlL3/5+eefd1rEOeec48WPB3CX1QuKkR47duzChQvdhxxTCiD6xBNPhH3Ap9c111zzgx/8IOvNDz74YHNzM5dwMCaOPPJIfMBXDBVAurjtggsumDFjRqc1/+KLL37+859nvYT68JqjfFTsiiuuaGpq4u+SQT2A9qOPPspnBa6OHj3ay9icdNJJWbsFJcCA6D059Mgjj8jY0Yn233//e+65JxfG+uSTTxYvXtzpC2RXpwthpN97772sl8rKyo444ohOS6itrT399NPFdD/33HNd2iw+V1dXL1q0KOtt++677+GHH94l35KNKjIk5NCFF164e/furCUcd9xxXRWWlRnqKbXondatW+c0UjK5u37cVKFHvePRTHUBkk7+zI4tkb1BHp9y0TuQMR7f6+W2WCzm1GOwTvYwxfcW5SaxPA6oO3vsPYzlMsAe/Zk5Kntv/OddYjkJMIxie3v7dwvodLvtvYKxepbKy8u5i4XLZ6inuro6fmnz5s0vvvgi5zwA+WOPPdZp2cSJ6uvrAUeymgU7duw47bTTIC85xnr77bezDj8kCi51BMUoYfXq1fIvr7322tatW3lthwwZIjyQmB5nnHEGVCG3RfAUYGXW2gJgbNu2rac6Fn2FHstqAKEyL7zwAvcz4etRRx3l5Jj9L2YsAJr58+eLr9OmTVuwYAH//FGGxKX169fj5i4VjiGcPn161ktnnnkmOld8HTFiRNb1ZozBj370Iy/vkj2f4KR//OMfQjXcd9994tLtt98ux0TI9Ic//AETqac6FiBv06ZNWeUoukX2l3744YdW3MFeoW/N3eCkGa31S6XLtXKR+fIlyConZ6z3FW6POMNl6ckjePUusTyC9L2pGb81xnIaYHcfj3zVoyfQo1u/x80uGTijDrKq6llfWq8W/l+gCtHRwuOHxmP2oDs6CqdgMOjUNfgdV2HK4YP5NYHVUAiwUVYLAFd7NT7EyJDgXTRKVB6fUTG0EQ1HHRKJBGqIz/gxt4WgrA0UhfOexOtcCt+b6wR7j7FWrFhx+umnCxa58847H374YRtj8X4fMGBA1hL69eu3dOlSjCJnrLvvvhs4Bh/wyOjRo9esWdNxvuKq05J+j9Arr7wyatQozlhQSf/6178GDhzIL11xxRVnn302ZywAuO9///sYft7A6urqHCzTN954o3///h15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";
    var aliBase64 = "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";

    var dw = new Window("dialog", "感谢支持 ☕", undefined, {closeButton: true});
    dw.orientation   = "column";
    dw.alignChildren = ["center", "top"];
    dw.spacing  = 12;
    dw.margins  = 20;

    // 预先写出两个临时文件
    var tmpWX  = null;
    var tmpAli = null;
    try { tmpWX  = writeBase64TempFile(wxBase64,  "wx_qr.png");  } catch(e) {}
    try { tmpAli = writeBase64TempFile(aliBase64, "ali_qr.png"); } catch(e) {}

    // 当前显示状态：0 = 微信，1 = 支付宝
    var currentMode = 0;

    // 二维码容器
    var grpQR = dw.add("group");
    grpQR.orientation   = "column";
    grpQR.alignChildren = ["center", "top"];
    grpQR.spacing = 8;

    var panelQR = grpQR.add("panel", undefined, "");
    panelQR.preferredSize = [210, 210];
    panelQR.alignChildren = ["center", "center"];
    panelQR.margins = 0;

    // 加载图片，失败则显示文字占位
    var imgEl = null;
    if (tmpWX) {
        try { imgEl = panelQR.add("image", undefined, tmpWX); imgEl.preferredSize = [200, 200]; } catch(e) {}
    }
    if (!imgEl) {
        panelQR.add("statictext", undefined, "图片加载失败");
    }

    // 标签：显示当前是哪个收款码
    var lblCurrent = grpQR.add("statictext", undefined, "💚 微信（**钦）");
    lblCurrent.graphics.font = ScriptUI.newFont("dialog", "BOLD", 12);

    // 切换按钮
    var btnSwitch = dw.add("button", undefined, "切换为支付宝收款码");
    btnSwitch.preferredSize.width = 180;

    btnSwitch.onClick = function() {
        currentMode = (currentMode === 0) ? 1 : 0;

        // 移除旧图片
        try {
            for (var ci = panelQR.children.length - 1; ci >= 0; ci--) {
                panelQR.remove(panelQR.children[ci]);
            }
        } catch(e) {}

        // 加载新图片
        var newPath = (currentMode === 0) ? tmpWX : tmpAli;
        var newImg  = null;
        if (newPath) {
            try {
                newImg = panelQR.add("image", undefined, newPath);
                newImg.preferredSize = [200, 200];
            } catch(e) {}
        }
        if (!newImg) {
            panelQR.add("statictext", undefined, "图片加载失败");
        }

        // 更新标签和按钮文字
        if (currentMode === 0) {
            lblCurrent.text  = "💚 微信（**钦）";
            btnSwitch.text   = "切换为支付宝收款码";
        } else {
            lblCurrent.text  = "💙 支付宝（**钦）";
            btnSwitch.text   = "切换为微信收款码";
        }

        // 刷新界面
        try { dw.layout.layout(true); } catch(e) {}
        try { panelQR.layout.layout(true); } catch(e) {}
    };

// 底部提示（随机文案）
    var tipTexts = [
        "你的每一次赞助，都是这个小工具持续迭代的动力。感谢认可！",
        "感谢你的支持与赞助，让它变得更好用。",
        "打赏防崩溃，愿你的软件永远不闪退，方案一遍过。🙏",
        "感谢支持，祝你的工程文件永远不用命名为“最终版_绝对不改版_v10”。",
        "赞助一点电费，让我的电脑少冒点烟。",
        "省下来的时间拿去摸鱼不香吗？赞助一下帮你创造摸鱼时间的人吧。",
        "你的打赏，决定了作者今晚泡的是明前老树，还是白开水。🍵",
        "不求别墅靠大海，只求买点好茶叶。感谢支持！",
        "bug改得苦，全靠这口茶。感谢你的茶叶基金！",
        "效率提上去了，不如坐下来喝杯茶？顺便请我也喝一杯。",
        "每收到一笔打赏，作者的黑眼圈就会淡化 0.01%",
        "这笔钱将专项用于修复作者因为查 Bug 而受损的脑细胞。",
        "你打赏的不是钱，是防止作者放弃更新的定心丸。",
        "赞助你的专属赛博包工头，让他继续为你肝代码。",
        "用爱发电不易，你的支持能让这台老旧的“人体发电机”多转两圈。",
        "白嫖固然爽，但打赏的姿势更优雅。✨",
        "如果觉得好用，就用打赏狠狠地“羞辱”我吧！",
        "经玄学测算，打赏作者能有效提升今天的出图运气值。",
        "你的一次支持，足以让屏幕背后的那个家伙傻笑半天。",
        "好的工具值得被看见，也期待你的‘实质性’夸奖！",
        "每一次扫码，都会导致远方某个默默写代码的家伙，嘴角疯狂上扬且难以压制。",
        "叮！你的打赏已到账，作者正在屏幕后为你表演一个无实物滑跪感谢。",
        "收到这笔打赏后，我决定今晚敲击键盘的力度都变得温柔一些。",
        "你的一次支持，够我拿着手机截图，在朋友群里得瑟好几天了。",
        "这笔赞助大概率会变成我今晚夜宵里，那根额外加餐的淀粉肠。",
        "每多一份支持，作者头顶那根摇摇欲坠的头发，就决定再多坚持一天。",
        "经临床验证：打赏能有效缓解独立开发者的颈椎酸痛（主要靠心理作用）。",
        "这笔钱将成立专项基金，用于给我的电脑风扇清一次灰，让它能继续肝。",
        "虽然赞助买不回我掉的头发，但足以抚慰我被各种报错弹窗折磨的心灵。",
        "感谢赞助！这笔巨款已存入作者的买茶基金，祝你导出来的图永远不偏色。"
    ];
    var randomTip = tipTexts[Math.floor(Math.random() * tipTexts.length)];

    var grpTips = dw.add("group");
    grpTips.orientation   = "column";
    grpTips.alignChildren = ["center", "top"];
    grpTips.alignment     = ["center", "top"];
    
    // 开启多行支持，设定文本居中并固定最大宽度以防界面变形
    var lblTip = grpTips.add("statictext", undefined, randomTip, {multiline: true});
    lblTip.justify = "center";
    lblTip.preferredSize.width = 260; 

    var btnClose = dw.add("button", undefined, "关闭", {name: "cancel"});
    btnClose.preferredSize.width = 100;
    btnClose.onClick = function() {
        try { if (tmpWX)  (new File(tmpWX)).remove();  } catch(e) {}
        try { if (tmpAli) (new File(tmpAli)).remove(); } catch(e) {}
        dw.close();
    };

    dw.onClose = function() {
        try { if (tmpWX)  (new File(tmpWX)).remove();  } catch(e) {}
        try { if (tmpAli) (new File(tmpAli)).remove(); } catch(e) {}
    };

    dw.show();
}

// 将Base64字符串写入系统临时文件夹，返回文件路径字符串
// 兼容 Windows / macOS，PS 2020-2026+
function writeBase64TempFile(base64Str, fileName) {
    try {
        // 获取系统临时目录（跨平台）
        var tmpFolder;
        try {
            tmpFolder = Folder.temp;
        } catch(e) {
            tmpFolder = new Folder("/tmp");
        }

        var tmpFile = new File(tmpFolder.fsName + "/" + fileName);

        // 将 Base64 解码并写入二进制文件
        // ScriptUI File 对象支持二进制写入
        if (tmpFile.open("w")) {
            tmpFile.encoding = "BINARY";
            // 关闭重新以二进制打开
            tmpFile.close();
        }

        // 使用 BridgeTalk / 二进制写文件方式
        tmpFile = new File(tmpFolder.fsName + "/" + fileName);
        tmpFile.open("w");
        tmpFile.encoding = "BINARY";

        // Base64 解码
        var decoded = base64Decode(base64Str);
        tmpFile.write(decoded);
        tmpFile.close();

        if (tmpFile.exists && tmpFile.length > 0) {
            return tmpFile.fsName;
        }
        return null;
    } catch(e) {
        return null;
    }
}

// Base64 解码函数（纯 ExtendScript 实现，无需外部依赖）
function base64Decode(input) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    // 清理非法字符（换行、空格等）
    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
    var i = 0;
    while (i < input.length) {
        var enc1 = chars.indexOf(input.charAt(i++));
        var enc2 = chars.indexOf(input.charAt(i++));
        var enc3 = chars.indexOf(input.charAt(i++));
        var enc4 = chars.indexOf(input.charAt(i++));

        var chr1 = (enc1 << 2) | (enc2 >> 4);
        var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        var chr3 = ((enc3 & 3) << 6) | enc4;

        output += String.fromCharCode(chr1);
        if (enc3 !== 64) output += String.fromCharCode(chr2);
        if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    return output;
}
function createUI() {
    var prefs     = loadPrefs();
    var inFolder  = prefs.inFolder;
    var outFolder = prefs.outFolder;
    var psVer        = getPSVersion();
    var supportsWebP = (psVer >= 23.2);

    var FMT_JPG  = "JPG";
    var FMT_PNG  = "PNG";
    var FMT_WEBP = "WebP";

    var formatArray = supportsWebP
        ? [FMT_JPG, FMT_PNG, FMT_WEBP]
        : [FMT_JPG, FMT_PNG];

    var win = new Window("dialog", "批量导出（JPG/PNG/webP）", undefined, {closeButton: true});
    win.orientation   = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing  = 10;
    win.margins  = 16;

    // ── 1. 数据源 ─────────────────────────────────────────────
    var panelSource = win.add("panel", undefined, "1. 数据源");
    panelSource.orientation   = "column";
    panelSource.alignChildren = ["fill", "top"];
    panelSource.margins = 15;

    var grpRadio  = panelSource.add("group");
    grpRadio.orientation = "column";
    grpRadio.alignChildren = ["left", "top"];
    
    var radFolder = grpRadio.add("radiobutton", undefined, "选择文件夹中的所有图片");
    var radOpen   = grpRadio.add("radiobutton", undefined, "当前 PS 已打开的所有图片");
    var radActive = grpRadio.add("radiobutton", undefined, "仅当前打开的文件（单张）");
    var radLayers = grpRadio.add("radiobutton", undefined, "当前选中的图层（自动裁切实际像素边界）");

    var grpIn = panelSource.add("group");
    var btnIn = grpIn.add("button",   undefined, "选择源文件夹");
    var txtIn = grpIn.add("edittext", undefined, "", {readonly: true});
    txtIn.characters = 30;

    btnIn.onClick = function() {
        var sel = Folder.selectDialog("请选择要处理的图片源文件夹");
        if (sel) { inFolder = sel; txtIn.text = decodeURI(inFolder.fsName); }
    };
    
    function updateSourceUI() {
        var isFolder = radFolder.value;
        btnIn.enabled = isFolder;
        txtIn.enabled = isFolder;
    }
    
    radFolder.onClick = updateSourceUI;
    radOpen.onClick   = updateSourceUI;
    radActive.onClick = updateSourceUI;
    radLayers.onClick = updateSourceUI;

    // ── 2. 输出位置 ───────────────────────────────────────────
    var panelOut = win.add("panel", undefined, "2. 输出位置");
    panelOut.orientation   = "column";
    panelOut.alignChildren = ["fill", "top"];
    panelOut.margins = 15;

    var grpOut = panelOut.add("group");
    var btnOut = grpOut.add("button",   undefined, "选择保存文件夹");
    var txtOut = grpOut.add("edittext", undefined, "", {readonly: true});
    txtOut.characters = 30;

    btnOut.onClick = function() {
        var sel = Folder.selectDialog("请选择处理后的图片保存位置");
        if (sel) { outFolder = sel; txtOut.text = decodeURI(outFolder.fsName); }
    };

    // ── 3. 导出参数 ───────────────────────────────────────────
    var panelSettings = win.add("panel", undefined, "3. 导出参数");
    panelSettings.orientation   = "column";
    panelSettings.alignChildren = ["fill", "top"];
    panelSettings.margins = 15;
    panelSettings.spacing = 8;

    var grpFormat = panelSettings.add("group");
    grpFormat.alignChildren = ["left", "center"];
    grpFormat.add("statictext", undefined, "导出格式:");
    var dropFormat = grpFormat.add("dropdownlist", undefined, formatArray);

    var grpJpgQuality = panelSettings.add("group");
    grpJpgQuality.alignChildren = ["left", "center"];
    grpJpgQuality.add("statictext", undefined, "品质(1-100):");
    var dropQuality = grpJpgQuality.add("dropdownlist", undefined,
        ["低 (10%)", "中 (30%)", "高 (60%)", "非常高 (80%)", "最佳 (100%)", "自定义"]);
    var inputQuality = grpJpgQuality.add("edittext", undefined, "80");
    inputQuality.characters = 4;

    dropQuality.onChange = function() {
        var vals = [10, 30, 60, 80, 100], idx = dropQuality.selection.index;
        if (idx < 5) inputQuality.text = String(vals[idx]);
    };
    inputQuality.onChange = function() {
        var v = parseInt(inputQuality.text, 10);
        if (isNaN(v) || v < 1)  { v = 1;   inputQuality.text = "1";   }
        if (v > 100)             { v = 100; inputQuality.text = "100"; }
        var ps = [10, 30, 60, 80, 100], m = false;
        for (var i = 0; i < ps.length; i++) {
            if (v === ps[i]) { dropQuality.selection = i; m = true; break; }
        }
        if (!m) dropQuality.selection = 5;
    };

    var grpPngOptions = panelSettings.add("group");
    grpPngOptions.alignChildren = ["left", "center"];
    var chkPngTransparent = grpPngOptions.add("checkbox", undefined,
        "导出透明背景（取消勾选则合并为白色背景）");
    chkPngTransparent.value = prefs.pngTransparent;

    var grpWebPMode = panelSettings.add("group");
    grpWebPMode.alignChildren = ["left", "center"];
    grpWebPMode.add("statictext", undefined, "压缩方式:");
    var radWebPLossless = grpWebPMode.add("radiobutton", undefined, "无损");
    var radWebPLossy    = grpWebPMode.add("radiobutton", undefined, "有损");

    var grpWebPQ = panelSettings.add("group");
    grpWebPQ.alignChildren = ["left", "center"];
    grpWebPQ.add("statictext", undefined, "WebP 品质(Q):");
    var inputWebPQ = grpWebPQ.add("edittext", undefined, "75");
    inputWebPQ.characters = 4;
    var dropWebPQ = grpWebPQ.add("dropdownlist", undefined,
        ["最小值 (0)", "低 (25)", "中 (50)", "高 (75)", "最佳 (100)", "自定义"]);

    dropWebPQ.onChange = function() {
        var vals = [0, 25, 50, 75, 100], idx = dropWebPQ.selection.index;
        if (idx < 5) inputWebPQ.text = String(vals[idx]);
    };
    inputWebPQ.onChange = function() {
        var t = inputWebPQ.text;
        if (t === "") return;
        var v = parseInt(t, 10);
        if (isNaN(v) || v < 0)  { v = 0;   inputWebPQ.text = "0";   }
        if (v > 100)             { v = 100; inputWebPQ.text = "100"; }
        var ps = [0, 25, 50, 75, 100], m = false;
        for (var i = 0; i < ps.length; i++) {
            if (v === ps[i]) { dropWebPQ.selection = i; m = true; break; }
        }
        if (!m) dropWebPQ.selection = 5;
    };
    radWebPLossless.onClick = function() { inputWebPQ.enabled = false; dropWebPQ.enabled = false; };
    radWebPLossy.onClick    = function() { inputWebPQ.enabled = true;  dropWebPQ.enabled = true;  };

    var grpWebPMeta = panelSettings.add("group");
    grpWebPMeta.orientation   = "column";
    grpWebPMeta.alignChildren = ["left", "top"];
    grpWebPMeta.spacing = 3;
    var chkWebPXMP  = grpWebPMeta.add("checkbox", undefined, "包括 XMP 元数据（版权/关键词/描述等）");
    var chkWebPEXIF = grpWebPMeta.add("checkbox", undefined, "包括 EXIF 元数据（相机参数/拍摄时间/GPS 等）");
    var chkWebPPS   = grpWebPMeta.add("checkbox", undefined, "包括 Photoshop 附加功能（网页用途建议不勾）");

    var grpSizeRow  = panelSettings.add("group");
    var chkOrigSize = grpSizeRow.add("checkbox", undefined, "按原尺寸导出（忽略下方宽高设置）");

    var grpSize = panelSettings.add("group");
    grpSize.add("statictext", undefined, "目标宽(px):");
    var inputW = grpSize.add("edittext", undefined, ""); inputW.characters = 6;
    grpSize.add("statictext", undefined, "  高度上限(px):");
    var inputH = grpSize.add("edittext", undefined, ""); inputH.characters = 6;

    var note1 = panelSettings.add("statictext", undefined,
        "※ 填目标宽：强制缩至该宽度，高自适应；缩后高超上限则改按高缩。两者留空则不缩放。",
        {multiline: true});
    note1.preferredSize.width  = 400;
    note1.preferredSize.height = 32;

    chkOrigSize.onClick = function() {
        inputW.enabled = !chkOrigSize.value;
        inputH.enabled = !chkOrigSize.value;
        if (chkOrigSize.value) { inputW.text = ""; inputH.text = ""; }
    };

    var grpSizeLimit = panelSettings.add("group");
    grpSizeLimit.alignChildren = ["left", "center"];
    grpSizeLimit.add("statictext", undefined, "文件大小上限:");
    var inputMaxSize = grpSizeLimit.add("edittext", undefined, ""); inputMaxSize.characters = 8;
    var dropSizeUnit = grpSizeLimit.add("dropdownlist", undefined, ["KB", "MB"]);
    dropSizeUnit.preferredSize.width = 55;
    var lblSizeNote = grpSizeLimit.add("statictext", undefined, "（留空不限制）");
    lblSizeNote.preferredSize.width = 100; // 恢复短文本宽度，防止挤压同行UI

    // 新增：长段详细说明，加高加宽，多行显示
    var note2 = panelSettings.add("statictext", undefined,
        "※ 仅 JPG 支持：自动降质逼近目标体积（处理较慢）。\n为保画质底线，细节极度丰富的图片可能无法强压至目标值。",
        {multiline: true});
    note2.preferredSize.width  = 420; // 加宽
    note2.preferredSize.height = 42;  // 增加高度，完美容纳两行文字

    var grpMeta = panelSettings.add("group");
    grpMeta.alignChildren = ["left", "center"];
    grpMeta.add("statictext", undefined, "元数据:");
    var dropMeta = grpMeta.add("dropdownlist", undefined,
        ["无", "版权", "版权和联系信息", "除相机信息外的全部", "全部"]);

    var grpOptions = panelSettings.add("group");
    var chkSRGB    = grpOptions.add("checkbox", undefined, "转为 sRGB");

    function getSelectedFormat() {
        if (!dropFormat.selection) return FMT_JPG;
        var txt = dropFormat.selection.text;
        if (txt === FMT_WEBP) return FMT_WEBP;
        if (txt === FMT_PNG)  return FMT_PNG;
        return FMT_JPG;
    }

    function applyFormat() {
        var fmt   = getSelectedFormat();
        var isJPG = (fmt === FMT_JPG);
        var isPNG = (fmt === FMT_PNG);
        var isWP  = (fmt === FMT_WEBP);

        grpJpgQuality.visible = !isWP;
        grpPngOptions.visible = isPNG;
        grpWebPMode.visible   = isWP;
        grpWebPQ.visible      = isWP;
        grpWebPMeta.visible   = isWP;
        grpMeta.visible       = !isWP;

        dropQuality.enabled  = isJPG;
        inputQuality.enabled = isJPG;
        inputMaxSize.enabled = isJPG;
        dropSizeUnit.enabled = isJPG;
        
        // 恢复右侧单行小字提示，保持UI整洁
        lblSizeNote.text     = isJPG ? "（留空不限制）" : "（仅支持JPG）";
    }

    dropFormat.onChange = function() { applyFormat(); };

    // ── 恢复上次设置 ──────────────────────────────────────────
    if (prefs.sourceType === 1) { radOpen.value = true; radFolder.value = false; radActive.value = false; radLayers.value = false; }
    else if (prefs.sourceType === 2) { radActive.value = true; radFolder.value = false; radOpen.value = false; radLayers.value = false; }
    else if (prefs.sourceType === 3) { radLayers.value = true; radFolder.value = false; radOpen.value = false; radActive.value = false; }
    else { radFolder.value = true; radOpen.value = false; radActive.value = false; radLayers.value = false; }
    updateSourceUI();

    if (inFolder)  txtIn.text  = decodeURI(inFolder.fsName);
    if (outFolder) txtOut.text = decodeURI(outFolder.fsName);

    var safeIdx = (prefs.formatIndex < formatArray.length) ? prefs.formatIndex : 0;
    dropFormat.selection = safeIdx;

    inputQuality.text = prefs.jpgQualityText;
    if (prefs.jpgQualityDrop >= 0 && prefs.jpgQualityDrop < 6)
        dropQuality.selection = prefs.jpgQualityDrop;

    radWebPLossless.value = prefs.webpLossless;
    radWebPLossy.value    = !prefs.webpLossless;
    inputWebPQ.text       = prefs.webpQualityText;
    if (prefs.webpQualityDrop >= 0 && prefs.webpQualityDrop < 6)
        dropWebPQ.selection = prefs.webpQualityDrop;
    if (prefs.webpLossless) { inputWebPQ.enabled = false; dropWebPQ.enabled = false; }

    chkWebPXMP.value  = prefs.webpXMP;
    chkWebPEXIF.value = prefs.webpEXIF;
    chkWebPPS.value   = prefs.webpPS;

    chkOrigSize.value = prefs.useOrigSize;
    inputW.text = prefs.targetW; inputH.text = prefs.targetH;
    if (prefs.useOrigSize) { inputW.enabled = false; inputH.enabled = false; }

    inputMaxSize.text = prefs.maxSize;
    if (prefs.sizeUnitIndex >= 0 && prefs.sizeUnitIndex < 2)
        dropSizeUnit.selection = prefs.sizeUnitIndex;
    if (prefs.metaIndex >= 0 && prefs.metaIndex < 5)
        dropMeta.selection = prefs.metaIndex;
    chkSRGB.value = prefs.doSRGB;

    applyFormat();

    // ── 按钮行 ────────────────────────────────────────────────
    var grpRun = win.add("group");
    grpRun.alignment = ["center", "top"];
    var btnRun   = grpRun.add("button", undefined, "开始批量处理", {name: "ok"});
    var btnClose = grpRun.add("button", undefined, "关闭",         {name: "cancel"});

    btnClose.onClick = function() { win.close(); };

    btnRun.onClick = function() {
        var sTypeStr = "folder";
        if (radOpen.value) sTypeStr = "open";
        else if (radActive.value) sTypeStr = "active";
        else if (radLayers.value) sTypeStr = "layers";

        if (radFolder.value && !inFolder)
            { alert("请先选择源文件夹！"); return; }
        if (!radFolder.value && app.documents.length === 0)
            { alert("当前没有已打开的图片！"); return; }
        if (!outFolder)
            { alert("请选择输出文件夹！"); return; }

        var selectedFormat = getSelectedFormat();
        var selIdx         = dropFormat.selection ? dropFormat.selection.index : 0;
        var isJPG = (selectedFormat === FMT_JPG);

        var quality = parseInt(inputQuality.text, 10) || 80;
        if (quality < 1)   quality = 1;
        if (quality > 100) quality = 100;

        var webpLossless = radWebPLossless.value;
        var webpQuality;
        if (!webpLossless) {
            var wv = parseInt(inputWebPQ.text, 10);
            webpQuality = isNaN(wv) ? 75 : wv;
            if (webpQuality < 0)   webpQuality = 0;
            if (webpQuality > 100) webpQuality = 100;
        } else { webpQuality = 100; }

        var useOrigSize  = chkOrigSize.value;
        var targetW      = useOrigSize ? 0 : (parseFloat(inputW.text) || 0);
        var targetH      = useOrigSize ? 0 : (parseFloat(inputH.text) || 0);
        var maxSizeInput = parseFloat(inputMaxSize.text) || 0;
        var maxKB = 0;
        if (isJPG && maxSizeInput > 0)
            maxKB = (dropSizeUnit.selection.index === 1) ? maxSizeInput * 1024 : maxSizeInput;

        var metaCharIDs = ["None", "Copr", "CpCn", "AlEx", "All "];
        var metaCharID  = metaCharIDs[dropMeta.selection ? dropMeta.selection.index : 0];
        var pngTransparent = chkPngTransparent.value;

        savePrefs(
            radFolder.value ? inFolder : null, outFolder,
            {
                sourceType:      radOpen.value ? 1 : (radActive.value ? 2 : (radLayers.value ? 3 : 0)),
                formatIndex:     selIdx,
                jpgQualityText:  inputQuality.text,
                jpgQualityDrop:  dropQuality.selection ? dropQuality.selection.index : 3,
                pngTransparent:  pngTransparent,
                webpLossless:    webpLossless,
                webpQualityText: inputWebPQ.text,
                webpQualityDrop: dropWebPQ.selection ? dropWebPQ.selection.index : 3,
                webpXMP:         chkWebPXMP.value,
                webpEXIF:        chkWebPEXIF.value,
                webpPS:          chkWebPPS.value,
                useOrigSize:     useOrigSize,
                targetW:         inputW.text,
                targetH:         inputH.text,
                maxSize:         inputMaxSize.text,
                sizeUnitIndex:   dropSizeUnit.selection ? dropSizeUnit.selection.index : 0,
                metaIndex:       dropMeta.selection ? dropMeta.selection.index : 0,
                doSRGB:          chkSRGB.value
            }
        );

        win.close();

        var result = processFiles(
            sTypeStr,
            inFolder, outFolder, selectedFormat, quality,
            targetW, targetH, useOrigSize, chkSRGB.value, maxKB, metaCharID,
            webpLossless, webpQuality,
            chkWebPXMP.value, chkWebPEXIF.value, chkWebPPS.value,
            pngTransparent
        );

        showResult(result.successCount, result.failList, result.cancelled);
    };

    // ── 打赏入口（随机文案） ───────────────────────────────────
    var donateTexts = [
        "效率提升了一点点？投喂开发者",
        "如果为你节省了时间 ⚡ 赞助开发",
        "工具虽小，贵在好用。支持后续开发",
        "给深夜改 bug 的作者一点精神鼓励",
        "你的赞助，能让作者的头发少掉两根",
        "觉得顺手？给作者加个鸡腿 🍗",
        "用爱发电不易，给作者充电 ⚡",
        "顺手好用的话，请作者喝杯好茶吧 🍵",
        "嘘……点开这里，可以捕获一只正在疯狂感恩的野生开发者。",
        "觉得好用？千万别点这里，我怕你的赞助让我兴奋得连夜加功能。",
        "只要你点开这行字，千里之外就会有个家伙看着屏幕嘿嘿傻笑。",
        "节省下来的时间，拿去摸鱼，或者……来这里调戏一下作者？",
        "帮你少点了一万次鼠标？戳这里给背后的打工人加个鸡腿。",
        "为了帮你跳过反人类的操作，有人掉了一小把头发，戳这里安慰他。",
        "帮到了你？点这里，防止开发者半夜修 Bug 修到道心破碎。",
        "觉得顺手的话，来给这个濒临崩溃的家伙投喂一点精神食粮吧。",
        "如果这工具帮你提早下了班，点这里请我喝口好茶吧！",
        "如果你恰好因为这玩意儿少加了会班，不打算进来请我喝一杯吗？",
        "每次有人点这里，我敲击代码的双手都会激动出残影。"
    ];
    var randomText = donateTexts[Math.floor(Math.random() * donateTexts.length)];

    var btnDonate = win.add("statictext", undefined, randomText);
    btnDonate.alignment = ["center", "top"];
    btnDonate.graphics.foregroundColor =
        btnDonate.graphics.newPen(btnDonate.graphics.PenType.SOLID_COLOR, [0.45, 0.52, 0.65], 1);
    btnDonate.addEventListener("click", function() { showDonateWindow(); });

    win.minimumSize = [500, supportsWebP ? 790 : 660];
    win.show();
}

// ============================================================
// 主处理流程
// ============================================================
function processFiles(sourceType, inFolder, outFolder, format, quality,
                      targetW, targetH, useOrigSize, doSRGB, maxKB, metaCharID,
                      webpLossless, webpQuality, webpXMP, webpEXIF, webpPS,
                      pngTransparent) {

    var docsToProcess = [];
    var layersToProcess = []; // 存储图层模式下要处理的图层信息
    
    if (sourceType === "folder") {
        var files = inFolder.getFiles(function(f) {
            if (f instanceof Folder) return false;
            return /\.(jpg|jpeg|png|tif|tiff|psd|webp)$/i.test(f.name);
        });
        if (files.length === 0) {
            alert("源文件夹中无支持图片！");
            return { successCount: 0, failList: [], cancelled: false };
        }
        docsToProcess = files;
    } else if (sourceType === "open") {
        for (var i = 0; i < app.documents.length; i++)
            docsToProcess.push(app.documents[i]);
    } else if (sourceType === "active") {
        if (app.documents.length === 0) {
            alert("当前没有已打开的图片！");
            return { successCount: 0, failList: [], cancelled: false };
        }
        docsToProcess.push(app.activeDocument);
    } else if (sourceType === "layers") {
        if (app.documents.length === 0) {
            alert("当前没有已打开的图片！");
            return { successCount: 0, failList: [], cancelled: false };
        }
        var ids = getSelectedLayerIDs();
        if (ids.length === 0) {
            alert("当前没有选中的图层！请在图层面板中选中至少一个图层。");
            return { successCount: 0, failList: [], cancelled: false };
        }
        var actDoc = app.activeDocument;
        for (var k = 0; k < ids.length; k++) {
            layersToProcess.push({
                doc: actDoc, 
                layerID: ids[k], 
                layerName: getLayerNameByID(ids[k])
            });
        }
    }

    var isLayerMode  = (sourceType === "layers");
    var total        = isLayerMode ? layersToProcess.length : docsToProcess.length;
    var successCount = 0;
    var failList     = [];
    var cancelled    = false;
    var pw           = createProgressWindow(total);

    for (var i = 0; i < total; i++) {
        var docName = "";
        if (isLayerMode) {
            docName = layersToProcess[i].layerName;
        } else {
            docName = (sourceType === "folder") ? decodeURI(docsToProcess[i].name) : docsToProcess[i].name;
        }
        pw.update(i, docName);

        var originalDoc      = null;
        var tempDoc          = null;
        var isOpenedByScript = false;
        var saveFile         = null;
        var exportSucceeded  = false;

        try {
            if (isLayerMode) {
                originalDoc = layersToProcess[i].doc;
                
                // 核心修复1：必须先新建透明文档，再切回原文档操作
                tempDoc = app.documents.add(originalDoc.width, originalDoc.height, originalDoc.resolution, "temp_layer", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
                
                // 核心修复2：切回原文档后，再精准选中我们要的那个 ID
                app.activeDocument = originalDoc;
                selectLayerByID(layersToProcess[i].layerID);
                
                // 复制过去
                originalDoc.activeLayer.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
                
                // 切换到新文档去裁切
                app.activeDocument = tempDoc;
                
                try {
                    tempDoc.activeLayer.visible = true;
                    tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
                } catch(e) {}
                
            } else {
                if (sourceType === "folder") {
                    originalDoc      = app.open(docsToProcess[i]);
                    isOpenedByScript = true;
                } else {
                    originalDoc = docsToProcess[i];
                }

                app.activeDocument = originalDoc;
                tempDoc = originalDoc.duplicate(originalDoc.name + "_temp");
                app.activeDocument = tempDoc;
                try { tempDoc.flattenImage(); } catch(e) {}
            }

            // 处理背景合并
            if (format === "PNG" && !pngTransparent) {
                try {
                    var bgLayer = tempDoc.artLayers.add();
                    bgLayer.move(tempDoc.layers[tempDoc.layers.length - 1], ElementPlacement.PLACEAFTER);
                    tempDoc.activeLayer = bgLayer;
                    var fillColor = new SolidColor();
                    fillColor.rgb.red   = 255;
                    fillColor.rgb.green = 255;
                    fillColor.rgb.blue  = 255;
                    tempDoc.selection.selectAll();
                    tempDoc.selection.fill(fillColor);
                    tempDoc.selection.deselect();
                    tempDoc.flattenImage();
                } catch(e) {}
            }

            // 处理 WebP 位深度
            if (format === "WebP") {
                try {
                    if (tempDoc.bitsPerChannel !== BitsPerChannelType.EIGHT)
                        tempDoc.bitsPerChannel = BitsPerChannelType.EIGHT;
                    if (tempDoc.mode !== DocumentMode.RGB)
                        tempDoc.changeMode(ChangeMode.RGB);
                } catch(e) {}
            }

            // 处理 sRGB 转换
            if (doSRGB) {
                try {
                    tempDoc.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, true);
                } catch(e) {}
            }

            // 处理分辨率缩放
            if (!useOrigSize) {
                var cW = tempDoc.width.as("px"), cH = tempDoc.height.as("px"), ratio = 1;
                if (targetW > 0) {
                    ratio = targetW / cW;
                    if (targetH > 0 && (cH * ratio) > targetH) ratio = targetH / cH;
                } else if (targetH > 0 && cH > targetH) {
                    ratio = targetH / cH;
                }
                if (Math.abs(ratio - 1) > 0.0001) {
                    tempDoc.resizeImage(
                        UnitValue(Math.round(cW * ratio), "px"),
                        UnitValue(Math.round(cH * ratio), "px"),
                        null, ResampleMethod.BICUBIC);
                }
            }

            // 决定输出的文件名
            var baseName = "";
            if (isLayerMode) {
                // 图层模式：原图名_图层名_序号，防止出现同名图层互相覆盖
                var origName = originalDoc.name;
                var dot = origName.lastIndexOf('.');
                if (dot > -1) origName = origName.substring(0, dot);
                origName = origName.replace(/[\/\\:*?"<>|]/g, "_");
                var safeLayerName = docName.replace(/[\/\\:*?"<>|]/g, "_");
                baseName = origName + "_" + safeLayerName + "_" + (i + 1);
            } else {
                baseName = originalDoc.name;
                var dot = baseName.lastIndexOf('.');
                if (dot > -1) baseName = baseName.substring(0, dot);
                baseName = baseName.replace(/[\/\\:*?"<>|]/g, "_");
            }

            var ext;
            if      (format === "PNG")  ext = ".png";
            else if (format === "WebP") ext = ".webp";
            else                        ext = ".jpg";

            if (!outFolder.exists) outFolder.create();
            saveFile = new File(outFolder.fsName + "/" + baseName + ext);

            exportWithSizeControl(
                tempDoc, saveFile, format, quality, maxKB, metaCharID,
                webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent
            );

            exportSucceeded = true;
            successCount++;
            pw.done(i);

        } catch(err) {
            exportSucceeded = false;
            if (saveFile) deleteFile(saveFile.fsName);

            if (isUserCancel(err)) {
                cancelled = true;
                if (tempDoc) {
                    try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {}
                    tempDoc = null;
                }
                if (isOpenedByScript && originalDoc) {
                    try { originalDoc.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {}
                    originalDoc = null;
                }
                break;
            } else {
                failList.push(docName + " | " + err.message);
                pw.setFail(failList.length);
            }

        } finally {
            if (tempDoc) {
                try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {}
            }
            if (isOpenedByScript && originalDoc) {
                try { originalDoc.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {}
            }
        }
    }

    pw.close();

    // 仅在“所有打开的图片”模式下，询问是否要顺手清理主程序中的图片
    if (sourceType === "open" && successCount > 0 && !cancelled) {
        if (confirm("导出完成！\n\n是否保存并关闭所有已处理的原始文件？\n\n" +
                    "【是】保存并关闭\n【否】保持继续在 PS 中开启")) {
            for (var j = docsToProcess.length - 1; j >= 0; j--) {
                try {
                    app.activeDocument = docsToProcess[j];
                    docsToProcess[j].save();
                    docsToProcess[j].close(SaveOptions.SAVECHANGES);
                } catch(e) {
                    try { docsToProcess[j].close(SaveOptions.SAVECHANGES); } catch(e2) {}
                }
            }
        }
    }

    return { successCount: successCount, failList: failList, cancelled: cancelled };
}

function showResult(successCount, failList, cancelled) {
    var msg = cancelled
        ? "已取消。\n成功导出: " + successCount + " 张"
        : "完成！成功导出: " + successCount + " 张";
    if (failList.length > 0)
        msg += "\n\n失败/已清理 " + failList.length + " 张:\n" + failList.join("\n");
    alert(msg);
}

// ============================================================
// 导出入口（含 JPG 体积控制）
// ============================================================
function exportWithSizeControl(doc, saveFile, format, quality, maxKB, metaCharID,
                               webpLossless, webpQuality, webpXMP, webpEXIF, webpPS,
                               pngTransparent) {
    // PNG / WebP / 无大小限制：直接导出，不做体积检查
    if (format === "PNG" || format === "WebP" || maxKB <= 0) {
        doExport(doc, saveFile, format, quality, metaCharID,
            webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent);
        return;
    }

    // JPG 体积控制 - 使用二分查找大幅提速，并解决超标漏网之鱼
    var maxBytes = maxKB * 1024;

    // 1. 先用设定的最高品质导一次
    doExport(doc, saveFile, format, quality, metaCharID,
        webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent);
    $.sleep(150); 
    
    // 如果一次就达标，直接完事
    if (getFileSizeBytes(saveFile.fsName) <= maxBytes) return;

    // 2. 如果超标，开始二分查找 (搜索范围：品质 1 到 刚才试过的品质-1)
    var lowQ = 1;
    var highQ = quality - 1;
    var bestQ = -1;

    while (lowQ <= highQ) {
        var midQ = Math.floor((lowQ + highQ) / 2);
        
        doExport(doc, saveFile, format, midQ, metaCharID,
            webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent);
        $.sleep(150);
        
        var currentSize = getFileSizeBytes(saveFile.fsName);
        
        if (currentSize <= maxBytes) {
            // 如果体积达标了，记下这个品质，并尝试往上挑战一下更高画质
            bestQ = midQ;
            lowQ = midQ + 1;
        } else {
            // 如果依然超标，只能继续降低品质上限
            highQ = midQ - 1;
        }
    }

    // 3. 收尾判断：如果图片细节实在太多，连品质 1 都超标了，就强行用品质 1 兜底导出
    var finalQ = (bestQ !== -1) ? bestQ : 1;
    
    // 为了确保留在硬盘里的是正确的最终品质，额外导出最后一次
    doExport(doc, saveFile, format, finalQ, metaCharID,
        webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent);
}

function doExport(doc, saveFile, format, quality, metaCharID,
                  webpLossless, webpQuality, webpXMP, webpEXIF, webpPS, pngTransparent) {
    if (format === "WebP") {
        doExportWebP(doc, saveFile, webpLossless, webpQuality, webpXMP, webpEXIF, webpPS);
        return;
    }
    try {
        var opts = new ExportOptionsSaveForWeb();
        if (format === "JPG") {
            opts.format         = SaveDocumentType.JPEG;
            opts.quality        = quality;
            opts.optimized      = true;
            opts.includeProfile = true;
        } else {
            opts.format         = SaveDocumentType.PNG;
            opts.PNG8           = false;
            opts.transparency   = pngTransparent;
            opts.includeProfile = true;
        }
        doc.exportDocument(saveFile, ExportType.SAVEFORWEB, opts);
    } catch(e) {
        if (isUserCancel(e)) throw e;
        // exportDocument 失败时降级走 Action
        doExportViaAction(doc, saveFile, format, quality, metaCharID, pngTransparent);
    }
}

function doExportWebP(doc, saveFile, lossless, quality,
                      includeXMP, includeEXIF, includePS) {
    app.activeDocument = doc;
    var desc = new ActionDescriptor(), desc2 = new ActionDescriptor();
    desc2.putEnumerated(s2t("compression"), s2t("WebPCompression"),
        s2t(lossless ? "compressionLossless" : "compressionLossy"));
    if (!lossless) desc2.putInteger(s2t("quality"), quality);
    desc2.putBoolean(s2t("includeXMPData"),  includeXMP);
    desc2.putBoolean(s2t("includeEXIFData"), includeEXIF);
    desc2.putBoolean(s2t("includePsExtras"), includePS);
    desc.putObject (s2t("as"),        s2t("WebPFormat"), desc2);
    desc.putPath   (s2t("in"),        saveFile);
    desc.putBoolean(s2t("copy"),      true);
    desc.putBoolean(s2t("lowerCase"), true);
    executeAction(s2t("save"), desc, DialogModes.NO);
}

function doExportViaAction(doc, saveFile, format, quality, metaCharID, pngTransparent) {
    app.activeDocument = doc;
    var dE = new ActionDescriptor(), dW = new ActionDescriptor();
    dW.putEnumerated(charIDToTypeID("Op  "), charIDToTypeID("SWOp"), charIDToTypeID("OpEq"));
    if (format === "JPG") {
        dW.putEnumerated(charIDToTypeID("Fmt "), charIDToTypeID("IRFm"), charIDToTypeID("JPEG"));
        dW.putInteger(charIDToTypeID("Qlty"), quality);
        dW.putBoolean(charIDToTypeID("Optm"), true);
        dW.putBoolean(charIDToTypeID("Prgr"), false);
    } else {
        dW.putEnumerated(charIDToTypeID("Fmt "), charIDToTypeID("IRFm"), charIDToTypeID("PN24"));
        dW.putBoolean(charIDToTypeID("Trns"), pngTransparent);
        dW.putBoolean(charIDToTypeID("Intl"), false);
    }
    dW.putBoolean(charIDToTypeID("ICC "), true);
    dW.putEnumerated(charIDToTypeID("MDfC"), charIDToTypeID("MdTa"), charIDToTypeID(metaCharID));
    dE.putObject(stringIDToTypeID("using"), stringIDToTypeID("SaveForWeb"), dW);
    dE.putPath(charIDToTypeID("In  "), saveFile);
    executeAction(stringIDToTypeID("export"), dE, DialogModes.NO);
}

createUI();