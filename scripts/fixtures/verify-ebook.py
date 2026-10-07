#!/usr/bin/env python3
"""EPUB / DOCX 格式规范级校验器（只依赖标准库）。

为什么在仓库里：以前这个脚本被扔在 /tmp，被系统清理后 `verify-ebook.mjs` 直接崩，
表现为「单跑全过、换台机器就失败」。放进仓库跟着 git 走，谁跑都一样。

输入：/tmp/nf-ebook/book.epub 与 /tmp/nf-ebook/book.docx（由 verify-ebook.mjs 生成）
输出：一行 JSON，字段固定，供 verify-ebook.mjs 断言。
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

XML_SUFFIXES = ('.xml', '.opf', '.xhtml', '.ncx', '.rels')


def parse_xml(data, where):
    """解析前先拒绝实体声明，防 XML 实体扩展（billion laughs）。

    EPUB/DOCX 是外部构造的压缩包，XML 内容视作不可信；
    `<!DOCTYPE html>` 这类无实体声明的正常 doctype 不拦。
    """
    if b'<!ENTITY' in data.upper():
        raise ValueError(f'{where}: 含实体声明（<!ENTITY），拒绝解析')
    return ET.fromstring(data)


def zip_xml_errors(zf):
    """所有 XML 类条目必须良构 —— 等价于 epubcheck / Word 的解析路径。"""
    errors = []
    for name in zf.namelist():
        if name.endswith(XML_SUFFIXES):
            try:
                parse_xml(zf.read(name), name)
            except Exception as exc:  # noqa: BLE001 - 要把解析错误原样报出来
                errors.append(f'{name}: {exc}')
    return errors


def local(tag):
    """去掉命名空间前缀：{ns}item -> item"""
    return tag.split('}', 1)[1] if '}' in tag else tag


def check_epub(path):
    out = {
        'testzip': None,
        'first_entry': None,
        'mimetype_ok': False,
        'spine_all_in_manifest': False,
        'has_nav': False,
        'xml_errors': [],
        'chapter_files': [],
        'dc_title': None,
        'dc_creator': None,
    }
    with zipfile.ZipFile(path) as zf:
        out['testzip'] = zf.testzip()
        infos = zf.infolist()
        out['first_entry'] = infos[0].filename if infos else None
        # EPUB 3 硬性要求：mimetype 必须是第一个条目且不压缩
        out['mimetype_ok'] = bool(
            infos
            and infos[0].filename == 'mimetype'
            and infos[0].compress_type == zipfile.ZIP_STORED
            and zf.read('mimetype').decode('utf-8') == 'application/epub+zip'
        )
        out['xml_errors'] = zip_xml_errors(zf)

        # container.xml 指向 OPF；取不到就退化成按扩展名找
        opf_path = None
        try:
            container = parse_xml(zf.read('META-INF/container.xml'), 'META-INF/container.xml')
            for el in container.iter():
                if local(el.tag) == 'rootfile' and el.get('full-path'):
                    opf_path = el.get('full-path')
                    break
        except KeyError:
            pass
        if not opf_path:
            opf_path = next((n for n in zf.namelist() if n.endswith('.opf')), None)

        manifest = {}
        spine_ids = []
        if opf_path:
            opf = parse_xml(zf.read(opf_path), opf_path)
            base = opf_path.rsplit('/', 1)[0] + '/' if '/' in opf_path else ''
            for el in opf.iter():
                tag = local(el.tag)
                if tag == 'item' and el.get('id'):
                    manifest[el.get('id')] = el.get('href') or ''
                    if 'nav' in (el.get('properties') or '').split():
                        out['has_nav'] = True
                elif tag == 'itemref' and el.get('idref'):
                    spine_ids.append(el.get('idref'))
                elif tag == 'title' and out['dc_title'] is None:
                    out['dc_title'] = (el.text or '').strip() or None
                elif tag == 'creator' and out['dc_creator'] is None:
                    out['dc_creator'] = (el.text or '').strip() or None
            # spine 里每一项都必须能在 manifest 找到（否则阅读器缺章）
            out['spine_all_in_manifest'] = bool(spine_ids) and all(i in manifest for i in spine_ids)
            # 正文章节文档 = manifest 里的 xhtml，排除 nav / toc
            out['chapter_files'] = sorted(
                base + href
                for href in manifest.values()
                if href.endswith('.xhtml') and 'nav' not in href.lower() and 'toc' not in href.lower()
            )
        if not out['has_nav']:
            out['has_nav'] = any('nav' in n.lower() and n.endswith('.xhtml') for n in zf.namelist())
    return out


def check_docx(path):
    out = {
        'testzip': None,
        'required_present': False,
        'xml_errors': [],
        'overrides': [],
        'has_page_break': False,
        'first_line_indent': False,
    }
    required = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']
    with zipfile.ZipFile(path) as zf:
        out['testzip'] = zf.testzip()
        names = zf.namelist()
        out['required_present'] = all(r in names for r in required)
        out['xml_errors'] = zip_xml_errors(zf)
        content_types = ''
        try:
            content_types = zf.read('[Content_Types].xml').decode('utf-8')
        except KeyError:
            pass
        out['overrides'] = re.findall(r'PartName="([^"]+)"', content_types)
        document = ''
        try:
            document = zf.read('word/document.xml').decode('utf-8')
        except KeyError:
            pass
        out['has_page_break'] = 'w:br' in document and 'w:type="page"' in document
        # 中文正文首行缩进 2 字符：w:firstLineChars="200"（由 document.xml 的段落属性给出）
        out['first_line_indent'] = 'w:firstLineChars="200"' in document
    return out


def main():
    result = {'epub': {}, 'docx': {}}
    try:
        result['epub'] = check_epub('/tmp/nf-ebook/book.epub')
    except Exception as exc:  # noqa: BLE001
        result['epub'] = {'xml_errors': [f'检查器异常: {exc}']}
    try:
        result['docx'] = check_docx('/tmp/nf-ebook/book.docx')
    except Exception as exc:  # noqa: BLE001
        result['docx'] = {'xml_errors': [f'检查器异常: {exc}']}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
