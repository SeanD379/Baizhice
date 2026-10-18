from pathlib import Path
try:
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import Paragraph
    from reportlab.lib.styles import ParagraphStyle
    has_reportlab = True
except ImportError:
    from PIL import Image, ImageDraw, ImageFont
    has_reportlab = False

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'samples'
OUT.mkdir(parents=True, exist_ok=True)
if has_reportlab:
    pdfmetrics.registerFont(TTFont('CN', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
    pdfmetrics.registerFont(TTFont('CN-Bold', 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))

docs = {
  'conditional': ('条件概率与乘法公式', [
    ('01  条件概率', '在已知事件 A 发生的前提下，事件 B 发生的概率记为 P(B|A)。只有 P(A)>0 时，下面的比值才有定义。'),
    ('计算公式', 'P(B|A) = P(A∩B) / P(A)，P(A)>0。'),
    ('02  乘法公式', '将条件概率定义改写，可得 P(A∩B) = P(A) × P(B|A)。使用这个写法时，条件概率中的 P(A) 必须大于零。'),
    ('03  一个例子', '一组 20 名同学中，有 12 人选修数学，其中 8 人同时选修物理。随机选择一名同学，已知他选修数学，则他同时选修物理的概率为 8/12 = 2/3。'),
    ('易错提醒', 'P(B|A) 与 P(A|B) 的已知条件不同，通常不能直接互换。先写清楚分母对应哪个条件事件。'),
  ]),
  'independence': ('事件的独立性', [
    ('01  定义', '若 P(A∩B) = P(A)P(B)，称事件 A 与 B 相互独立。这一定义也适用于概率为零的事件。'),
    ('02  条件概率表述', '当 P(A)>0 时，独立性等价于 P(B|A)=P(B)。已知 A 发生，不改变 B 发生的概率。'),
    ('03  独立与互斥', '互斥表示 A、B 不能同时发生，即 P(A∩B)=0。当 P(A)>0 且 P(B)>0 时，互斥事件不独立。不要省略这两个非零条件。'),
    ('04  一个例子', '独立投掷一枚公平硬币两次。A 表示第一次正面，B 表示第二次正面。P(A)=P(B)=1/2，P(A∩B)=1/4，因此 A 与 B 独立。'),
    ('复习检查', '不要用“看起来没有关系”代替判断。写出联合概率，再与两个事件概率的乘积比较。'),
  ]),
  'note': ('课堂笔记 · 冲突测试样例', [
    ('请注意：本页故意包含错误', '这是一份人为构造的异常测试资料，用来验证产品是否提示冲突。它不是真实学生笔记，也不能作为学习结论。'),
    ('待核对说法（错误）', '“只要两个事件互斥，它们就一定相互独立。”'),
    ('测试预期', '产品应提示上述说法与参考讲义冲突，让用户查看原文并决定本次是否排除该笔记。不能静默地把这条说法写入复习提纲。'),
    ('正确解释', '若两个事件概率都大于零，互斥意味着联合概率为零，两个概率的乘积却大于零，因此它们不独立。'),
  ]),
  'exercises': ('条件概率 · 配套练习与解析', [
    ('练习 1  条件概率', '一个学习小组有 10 人，其中 6 人学过概率论，这 6 人中有 3 人完成了复习提纲。随机选一人，已知他学过概率论，求他完成提纲的概率。'),
    ('解析 1', '条件事件是“学过概率论”，其范围内有 6 人，满足目标事件的有 3 人。因此所求概率为 3/6=1/2。'),
    ('练习 2  独立性', '已知 P(A)=0.4，P(B)=0.5，P(A∩B)=0.2。判断 A 与 B 是否独立。'),
    ('解析 2', 'P(A)P(B)=0.4×0.5=0.2，与 P(A∩B) 相等，因此 A 与 B 相互独立。'),
    ('本页用途', '本资料用于演示在已有提纲上补充练习解析。更新时应保留用户此前写下的复习说明。'),
  ])
}

sources = {}
source_labels = {}

for key, (title, sections) in docs.items():
    if not has_reportlab:
        if key not in sources:
            continue  # Existing math PDFs are preserved when only the Pillow fallback is available.
        image = Image.new('RGB', (1240, 1754), '#F8F8F3')
        draw = ImageDraw.Draw(image)
        regular = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 27)
        small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
        heading_font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 32)
        title_font = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc', 50)
        draw.rectangle((96, 105, 166, 113), fill='#376447')
        draw.text((96, 138), '高中语文 · 学习之道 / 中文演示资料', font=small, fill='#376447')
        draw.text((96, 215), title, font=title_font, fill='#1D2A20')
        draw.text((96, 294), '古文节选标明出处；整理与练习为自编演示资料。', font=small, fill='#637168')
        y = 385
        for heading, body in sections:
            draw.text((96, y), heading, font=heading_font, fill='#24422D')
            y += 60
            line = ''
            for char in body:
                if draw.textlength(line + char, font=regular) > 1035:
                    draw.text((96, y), line, font=regular, fill='#39443C')
                    y += 46
                    line = ''
                line += char
            if line:
                draw.text((96, y), line, font=regular, fill='#39443C')
                y += 46
            y += 40
        if y > 1560:
            raise ValueError(f'Page overflow: {key}')
        draw.line((96, 1630, 1144, 1630), fill='#DCE2D7', width=2)
        draw.text((96, 1650), sources[key][0], font=small, fill='#376447')
        draw.text((96, 1680), source_labels[key], font=small, fill='#637168')
        draw.text((96, 1710), '学习资料工作台 · 演示素材', font=small, fill='#637168')
        image.save(OUT / f'{key}.pdf', 'PDF', resolution=150)
        print(f'{key}.pdf created (image PDF fallback)')
        continue
    c = canvas.Canvas(str(OUT / f'{key}.pdf'), pagesize=(595,842))
    c.setTitle(title)
    c.setAuthor('学习资料工作台 - 自编演示资料')
    c.setFillColor(HexColor('#F8F8F3')); c.rect(0,0,595,842,fill=1,stroke=0)
    c.setFillColor(HexColor('#376447')); c.rect(46,775,34,4,fill=1,stroke=0)
    c.setFont('CN',10); c.drawString(46,753,'高中语文 · 学习之道 / 中文演示资料' if key in sources else '概率论与数理统计 / 中文演示资料')
    c.setFillColor(HexColor('#1D2A20')); c.setFont('CN-Bold',23); c.drawString(46,711,title)
    c.setFont('CN',10); c.setFillColor(HexColor('#637168')); c.drawString(46,681,'古文节选标明出处；整理与练习为自编演示资料。' if key in sources else '由 AI 辅助自编，用于产品演示；不是高校课件或历年真题。')
    y=628
    for heading, body in sections:
        c.setFont('CN-Bold',12); c.setFillColor(HexColor('#24422D')); c.drawString(46,y,heading); y-=26
        c.setFont('CN',11); c.setFillColor(HexColor('#39443C'))
        paragraph = Paragraph(body, ParagraphStyle('body', fontName='CN', fontSize=11, leading=21, wordWrap='CJK', textColor=HexColor('#39443C')))
        _, height = paragraph.wrap(500, 700)
        paragraph.drawOn(c, 46, y - height + 11)
        y -= height
        y-=26
    if y<85: raise ValueError(f'Page overflow: {key}')
    if key in sources:
        label, url = sources[key]
        c.setFont('CN',9); c.setFillColor(HexColor('#376447')); c.drawString(46,72,label)
        c.linkURL(url, (46,66,300,85), relative=0)
    c.setStrokeColor(HexColor('#DCE2D7')); c.line(46,59,549,59)
    c.setFont('CN',9); c.setFillColor(HexColor('#637168')); c.drawString(46,39,'学习资料工作台 · 演示素材'); c.drawRightString(549,39,'第 1 页 / 共 1 页')
    c.save()
    print(f'{key}.pdf created')
