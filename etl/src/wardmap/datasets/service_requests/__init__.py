"""Service requests (C3 notifications): a local SQLite mirror kept current with deltas.

db.py         schema, row normalisation, bulk CSV bootstrap, ward assignment
sync.py       delta sync from the live ArcGIS layer (and full rebuild)
aggregate.py  per-ward metrics -> data/service_requests-<vintage>.json
"""
