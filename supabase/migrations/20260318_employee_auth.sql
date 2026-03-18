-- Employee identity verification + permission scope
-- Source demos:
-- 1) VPS-员工信息demo数据.xlsx (员工姓名/员工ID)
-- 2) VPS-架构demo数据.xlsx (SG/RM/DM/MICS/医院名称/医院编码)

create extension if not exists pgcrypto;

create table if not exists public.employee_identities (
    id uuid primary key default gen_random_uuid(),
    employee_code text not null unique,
    employee_name text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (employee_name, employee_code)
);

create table if not exists public.employee_permissions (
    id uuid primary key default gen_random_uuid(),
    sg text not null,
    rm text not null,
    dm text not null,
    mics text not null,
    hospital_name text not null,
    hospital_code text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create unique index if not exists employee_permissions_unique_row_idx
    on public.employee_permissions (sg, rm, dm, mics, hospital_name, hospital_code);

create index if not exists employee_permissions_hospital_code_idx
    on public.employee_permissions (hospital_code);

create index if not exists employee_permissions_mics_idx
    on public.employee_permissions (mics);

create index if not exists employee_permissions_dm_idx
    on public.employee_permissions (dm);

create index if not exists employee_permissions_rm_idx
    on public.employee_permissions (rm);

create index if not exists employee_permissions_sg_idx
    on public.employee_permissions (sg);

alter table if exists public.survey_results
    add column if not exists submitter_name text,
    add column if not exists submitter_code text;

create or replace function public.employee_login(
    p_employee_name text,
    p_employee_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := btrim(coalesce(p_employee_name, ''));
    v_code text := btrim(coalesce(p_employee_code, ''));
    v_valid boolean := false;
    v_hospitals jsonb := '[]'::jsonb;
begin
    if v_name = '' or v_code = '' then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name,
            'employee_code', v_code,
            'hospitals', '[]'::jsonb
        );
    end if;

    select exists (
        select 1
        from public.employee_identities
        where employee_name = v_name
          and employee_code = v_code
          and is_active = true
    )
    into v_valid;

    if not v_valid then
        return jsonb_build_object(
            'is_valid', false,
            'employee_name', v_name,
            'employee_code', v_code,
            'hospitals', '[]'::jsonb
        );
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'sg', x.sg,
                'rm', x.rm,
                'dm', x.dm,
                'mics', x.mics,
                'hospital_name', x.hospital_name,
                'hospital_code', x.hospital_code
            )
            order by x.hospital_code
        ),
        '[]'::jsonb
    )
    into v_hospitals
    from (
        select distinct
            p.sg,
            p.rm,
            p.dm,
            p.mics,
            p.hospital_name,
            p.hospital_code
        from public.employee_permissions p
        where p.is_active = true
          and (
            p.sg = v_name
            or p.rm = v_name
            or p.dm = v_name
            or p.mics = v_name
          )
    ) x;

    return jsonb_build_object(
        'is_valid', true,
        'employee_name', v_name,
        'employee_code', v_code,
        'hospitals', v_hospitals
    );
end;
$$;

revoke all on function public.employee_login(text, text) from public;
grant execute on function public.employee_login(text, text) to anon, authenticated, service_role;

insert into public.employee_identities (employee_code, employee_name, is_active)
values
    ('EMP_ZW01', '张伟经理', true),
    ('EMP_LQ02', '李强经理', true),
    ('EMP_WG03', '王刚经理', true),
    ('EMP_LJ04', '刘杰经理', true),
    ('EMP_CC05', '陈晨经理', true),
    ('EMP_ZM06', '赵敏经理', true),
    ('EMP_SL07', '孙亮经理', true),
    ('EMP_HB08', '黄波经理', true),
    ('EMP_ZJ09', '周杰经理', true),
    ('EMP_WM10', '吴敏经理', true),
    ('MIC_LM55', '李明', true),
    ('MIC_WF23', '王芳', true),
    ('MIC_ZQ11', '赵强', true),
    ('MIC_LY78', '刘洋', true),
    ('MIC_CJ34', '陈静', true),
    ('MIC_YC90', '杨晨', true),
    ('MIC_ZT12', '周涛', true),
    ('MIC_WL66', '吴丽', true),
    ('MIC_SB45', '孙波', true),
    ('MIC_ZJ88', '郑洁', true),
    ('MIC_FT21', '冯特', true),
    ('MIC_LH07', '罗浩', true),
    ('MIC_GX59', '郭旭', true),
    ('MIC_LH31', '梁红', true),
    ('MIC_YF16', '袁方', true),
    ('MIC_DF82', '邓飞', true),
    ('MIC_XY04', '谢勇', true),
    ('MIC_TP99', '唐平', true),
    ('MIC_XN73', '许诺', true),
    ('MIC_HX28', '韩雪', true),
    ('MIC_CJ14', '曹俊', true),
    ('MIC_PY50', '潘悦', true),
    ('MIC_DL09', '丁力', true),
    ('MIC_WZ37', '魏征', true),
    ('MIC_FY61', '付瑶', true),
    ('MIC_ZK22', '邹凯', true),
    ('MIC_WY48', '汪洋', true),
    ('MIC_QD15', '钱多多', true),
    ('MIC_YW77', '喻文', true),
    ('MIC_ZC06', '曾诚', true),
    ('MIC_XZ91', '肖战', true),
    ('MIC_LY25', '陆毅', true),
    ('MIC_JL83', '贾玲', true),
    ('MIC_FC19', '范丞', true),
    ('MIC_ST42', '沈腾', true),
    ('MIC_ML03', '玛丽', true),
    ('MIC_AL56', '艾伦', true),
    ('MIC_WX81', '魏翔', true),
    ('MIC_CY27', '常远', true),
    ('MIC_HC64', '黄才伦', true),
    ('MIC_QJ39', '屈菁菁', true),
    ('MIC_BG18', '卜冠今', true),
    ('MIC_QS70', '乔杉', true)
on conflict (employee_code)
do update
set employee_name = excluded.employee_name,
    is_active = excluded.is_active,
    updated_at = now();

insert into public.employee_permissions (sg, rm, dm, mics, hospital_name, hospital_code, is_active)
values
    ('基石北中国', '京津冀', '张伟经理', '李明', '北京市第一人民医院', 'BJ001', true),
    ('基石北中国', '京津冀', '张伟经理', '王芳', '天津市中心医院', 'TJ023', true),
    ('基石北中国', '京津冀', '张伟经理', '赵强', '石家庄市中医院', 'SJZ102', true),
    ('基石北中国', '京津冀', '张伟经理', '刘洋', '保定市第二医院', 'BD055', true),
    ('基石北中国', '京津冀', '张伟经理', '陈静', '唐山市工人医院', 'TS089', true),
    ('基石北中国', '京津冀', '张伟经理', '杨晨', '廊坊市人民医院', 'LF012', true),
    ('基石北中国', '京津冀', '张伟经理', '周涛', '秦皇岛市第一医院', 'QHD034', true),
    ('基石北中国', '京津冀', '张伟经理', '吴丽', '北京协和医院分院', 'BJ005', true),
    ('基石北中国', '京津冀', '张伟经理', '孙波', '天津医科大学附属医院', 'TJ045', true),
    ('基石北中国', '京津冀', '李强经理', '郑洁', '北京市朝阳医院', 'BJ009', true),
    ('基石北中国', '京津冀', '李强经理', '冯特', '北京市海淀医院', 'BJ015', true),
    ('基石北中国', '川云青', '王刚经理', '罗浩', '成都市华西医院', 'CD001', true),
    ('基石北中国', '川云青', '王刚经理', '郭旭', '昆明市第一人民医院', 'KM022', true),
    ('基石北中国', '川云青', '王刚经理', '梁红', '西宁市人民医院', 'XN005', true),
    ('基石北中国', '川云青', '王刚经理', '袁方', '绵阳市中心医院', 'MY018', true),
    ('基石北中国', '川云青', '王刚经理', '邓飞', '大理州人民医院', 'DL044', true),
    ('基石北中国', '新西渝', '刘杰经理', '谢勇', '乌鲁木齐市中心医院', 'WLMQ01', true),
    ('基石北中国', '新西渝', '刘杰经理', '唐平', '西安市西京医院', 'XA003', true),
    ('基石北中国', '新西渝', '刘杰经理', '许诺', '重庆市西南医院', 'CQ005', true),
    ('基石北中国', '荆豫', '陈晨经理', '韩雪', '武汉市同济医院', 'WH001', true),
    ('基石北中国', '荆豫', '陈晨经理', '曹俊', '郑州市第一人民医院', 'ZZ012', true),
    ('基石北中国', '荆豫', '陈晨经理', '潘悦', '长沙市湘雅医院', 'CS005', true),
    ('基石北中国', '东蒙晋', '赵敏经理', '丁力', '呼和浩特市第一医院', 'HHHT01', true),
    ('基石北中国', '东蒙晋', '赵敏经理', '魏征', '太原市中心医院', 'TY008', true),
    ('基石北中国', '东蒙晋', '赵敏经理', '付瑶', '包头市第八医院', 'BT045', true),
    ('基石南中国', '沪闽', '孙亮经理', '邹凯', '上海市中山医院', 'SH001', true),
    ('基石南中国', '沪闽', '孙亮经理', '汪洋', '厦门市第一医院', 'XM012', true),
    ('基石南中国', '沪闽', '孙亮经理', '钱多多', '福州市省立医院', 'FZ005', true),
    ('基石南中国', '沪闽', '孙亮经理', '喻文', '上海市瑞金医院', 'SH003', true),
    ('基石南中国', '粤海', '黄波经理', '曾诚', '广州市南方医院', 'GZ001', true),
    ('基石南中国', '粤海', '黄波经理', '肖战', '深圳市人民医院', 'SZ005', true),
    ('基石南中国', '粤海', '黄波经理', '陆毅', '海口市中心医院', 'HK009', true),
    ('基石南中国', '中南', '周杰经理', '贾玲', '南昌市第一医院', 'NC001', true),
    ('基石南中国', '中南', '周杰经理', '范丞', '衡阳市中心医院', 'HY022', true),
    ('基石南中国', '浙熤', '吴敏经理', '沈腾', '杭州市浙一医院', 'HZ001', true),
    ('基石南中国', '浙熤', '吴敏经理', '玛丽', '宁波市第二医院', 'NB015', true),
    ('基石南中国', '浙熤', '吴敏经理', '艾伦', '温州市医科大学附属医院', 'WZ033', true),
    ('基石南中国', '浙熤', '吴敏经理', '魏翔', '绍兴市人民医院', 'SX004', true),
    ('基石南中国', '浙熤', '吴敏经理', '常远', '嘉兴市中心医院', 'JX012', true),
    ('基石南中国', '浙熤', '吴敏经理', '黄才伦', '金华市中心医院', 'JH045', true),
    ('基石南中国', '浙熤', '吴敏经理', '屈菁菁', '台州市中心医院', 'TZ022', true),
    ('基石南中国', '浙熤', '吴敏经理', '卜冠今', '舟山市人民医院', 'ZS003', true),
    ('基石南中国', '浙熤', '吴敏经理', '乔杉', '丽水市中心医院', 'LS009', true)
on conflict (sg, rm, dm, mics, hospital_name, hospital_code)
do update
set is_active = excluded.is_active;
