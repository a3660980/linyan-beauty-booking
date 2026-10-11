-- Apply supplied root-specific durations without changing existing appointments or prices.
UPDATE services SET data=json_set(data,'$.specs',json((
 SELECT json_group_array(CASE CAST(REPLACE(json_extract(value,'$.label'),' 根','') AS INTEGER)
 WHEN 100 THEN json_set(value,'$.duration',80)
 WHEN 150 THEN json_set(value,'$.duration',90)
 WHEN 200 THEN json_set(value,'$.duration',100)
 WHEN 300 THEN json_set(value,'$.duration',120)
 ELSE json(value) END) FROM json_each(services.data,'$.specs')
))) WHERE id IN ('single','3d','6d','yy');
