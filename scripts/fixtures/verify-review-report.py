#!/usr/bin/env python3
"""审稿报告 DOCX 的规范级校验（只依赖标准库）。

与 verify-ebook.py 同源思路：ZIP 完整性、XML 良构、必需部件。
另外抽取正文里的全部 <w:t> 文本，供 JS 侧断言"某段批注确实进了报告"。

为什么不复用 verify-ebook.py：那份的路径与字段是写死的（/tmp/nf-ebook/*），
报告 DOCX 是另一个文件、断言点也不同（要抽正文文本）。

输入：/tmp/nf-review-report/report.docx
输出：一行 JSON。
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

XML_SUFFIXES = ('.xml', '.rels')
W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def parse_xml(data, where):
    if b'<!ENTITY' in data.upper():
        raise ValueError(f'{where}: 含实体声明（<!ENTITY），拒绝解析')
    return ET.fromstring(data)


def main():
    path = '/tmp/nf-review-report/report.docx'
    out = {
        'testzip': None,
        'required_present': False,
        'xml_errors': [],
        'overrides': [],
        'paragraph_count': 0,
        'text': '',
        'dc_title': None,
        'dc_creator': None,
        'has_quote_border': False,
    }
    required = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']
    try:
        with zipfile.ZipFile(path) as zf:
            out['testzip'] = zf.testzip()
            names = zf.namelist()
            out['required_present'] = all(r in names for r in required)
            for name in names:
                if name.endswith(XML_SUFFIXES):
                    try:
                        parse_xml(zf.read(name), name)
                    except Exception as exc:  # noqa: BLE001
                        out['xml_errors'].append(f'{name}: {exc}')
            try:
                ct = zf.read('[Content_Types].xml').decode('utf-8')
                out['overrides'] = re.findall(r'PartName="([^"]+)"', ct)
            except KeyError:
                pass
            doc_raw = zf.read('word/document.xml') if 'word/document.xml' in names else b''
            out['has_quote_border'] = b'<w:pBdr>' in doc_raw
            doc = ET.fromstring(doc_raw)
            paras = [el for el in doc.iter() if el.tag == W_NS + 'p']
            out['paragraph_count'] = len(paras)
            texts = []
            for p in paras:
                texts.append(''.join(t.text or '' for t in p.iter() if t.tag == W_NS + 't'))
            out['text'] = '\n'.join(texts)
            try:
                core = ET.fromstring(zf.read('docProps/core.xml'))
                for el in core.iter():
                    tag = el.tag.split('}', 1)[-1]
                    if tag == 'title' and out['dc_title'] is None:
                        out['dc_title'] = (el.text or '').strip() or None
                    if tag == 'creator' and out['dc_creator'] is None:
                        out['dc_creator'] = (el.text or '').strip() or None
            except KeyError:
                pass
    except Exception as exc:  # noqa: BLE001
        out['xml_errors'].append(f'检查器异常: {exc}')
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())